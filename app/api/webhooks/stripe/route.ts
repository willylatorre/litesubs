import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/app/db";
import { liteSubscriptions, transactions } from "@/app/db/schema";
import { earningsLedger, payouts } from "@/app/db/payouts-schema";
import {
	type StripeConnectStatus,
	stripeConnectAccounts,
} from "@/app/db/stripe-connect-schema";
import { getStripe } from "@/lib/stripe";
import { mapOutboundPaymentEvent } from "@/lib/payouts";
import type { Stripe } from "stripe";

/**
 * Process checkout.session.completed event
 * Handles credit purchases with full idempotency
 */
async function handleCheckoutCompleted(
	checkoutSession: Stripe.Checkout.Session,
	eventId: string
): Promise<Response> {
	const metadata = checkoutSession.metadata;

	if (!metadata?.userId || !metadata?.productId) {
		console.error("Webhook received with missing metadata", { eventId });
		return new Response("Missing metadata", { status: 400 });
	}

	try {
		// Idempotency check: Check if this checkout session was already processed
		const existingTransaction = await db.query.transactions.findFirst({
			where: eq(transactions.stripeCheckoutId, checkoutSession.id),
		});

		// If transaction exists and is completed, this is a duplicate webhook
		if (existingTransaction?.status === "completed") {
			console.log("Checkout session already processed", {
				eventId,
				checkoutId: checkoutSession.id,
			});
			return new Response("Event already processed", { status: 200 });
		}

		const creditsToAdd = Number(metadata.credits);

		await db.transaction(async (tx) => {
			// Find or create subscription
			const subscription = await tx.query.liteSubscriptions.findFirst({
				where: and(
					eq(liteSubscriptions.userId, metadata.userId),
					eq(liteSubscriptions.productId, metadata.productId),
				),
			});

			if (!subscription) {
				// Create subscription if it doesn't exist (fallback)
				await tx.insert(liteSubscriptions).values({
					userId: metadata.userId,
					productId: metadata.productId,
					creatorId: metadata.creatorId,
					credits: creditsToAdd,
				});
			} else {
				// Update existing subscription credits
				await tx
					.update(liteSubscriptions)
					.set({
						credits: sql`${liteSubscriptions.credits} + ${creditsToAdd}`,
						updatedAt: new Date(),
					})
					.where(eq(liteSubscriptions.id, subscription.id));
			}

			// Check if this is a Stripe Connect transaction
			const usesStripeConnect = metadata.usesStripeConnect === "true";
			const stripeConnectAccountId = metadata.stripeConnectAccountId || null;
			const applicationFeeAmount = metadata.applicationFeeAmount
				? parseInt(metadata.applicationFeeAmount, 10)
				: null;

			// Update or Insert transaction
			if (existingTransaction) {
				await tx
					.update(transactions)
					.set({
						status: "completed",
						amountMoney: checkoutSession.amount_total ?? existingTransaction.amountMoney,
						currency: (checkoutSession.currency as any) ?? existingTransaction.currency,
						usesStripeConnect,
						stripeApplicationFee: applicationFeeAmount,
						stripeConnectAccountId,
					})
					.where(eq(transactions.id, existingTransaction.id));
			} else {
				// Create new transaction record
				await tx.insert(transactions).values({
					userId: metadata.userId,
					creatorId: metadata.creatorId,
					productId: metadata.productId,
					amount: creditsToAdd,
					amountMoney: checkoutSession.amount_total,
					currency: checkoutSession.currency as any,
					type: "purchase",
					description: `Purchase of ${creditsToAdd} credits`,
					stripeCheckoutId: checkoutSession.id,
					status: "completed",
					usesStripeConnect,
					stripeApplicationFee: applicationFeeAmount,
					stripeConnectAccountId,
				});
			}

			// Add to Earnings Ledger (only for non-Connect transactions)
			// For Stripe Connect, funds go directly to creator, so no ledger entry needed
			if (!usesStripeConnect && metadata.creatorId && checkoutSession.amount_total) {
				// Check if ledger entry already exists for this payment intent
				const paymentIntentId = checkoutSession.payment_intent as string;
				if (paymentIntentId) {
					const existingLedger = await tx.query.earningsLedger.findFirst({
						where: and(
							eq(earningsLedger.userId, metadata.creatorId),
							eq(earningsLedger.relatedPaymentIntentId, paymentIntentId),
							eq(earningsLedger.transactionType, "sale"),
						),
					});

					if (!existingLedger) {
						await tx.insert(earningsLedger).values({
							userId: metadata.creatorId,
							transactionType: "sale",
							amount: (checkoutSession.amount_total / 100).toFixed(2),
							currency: checkoutSession.currency || "usd",
							relatedPaymentIntentId: paymentIntentId,
							description: `Sale of ${creditsToAdd} credits`,
						});
					}
				}
			}
		});

		console.log("Checkout session processed successfully", {
			eventId,
			checkoutId: checkoutSession.id,
			userId: metadata.userId,
			credits: creditsToAdd,
		});

		return new Response(null, { status: 200 });
	} catch (error: any) {
		console.error("Failed to process checkout webhook:", {
			eventId,
			checkoutId: checkoutSession.id,
			error: error.message,
		});
		return new Response(`Webhook Error: ${error.message}`, { status: 500 });
	}
}

/**
 * Process checkout.session.expired event
 * Marks pending transactions as declined
 */
async function handleCheckoutExpired(
	checkoutSession: Stripe.Checkout.Session,
	eventId: string
): Promise<Response> {
	try {
		const existingTransaction = await db.query.transactions.findFirst({
			where: eq(transactions.stripeCheckoutId, checkoutSession.id),
		});

		// Only update if transaction exists and is still ongoing
		if (existingTransaction?.status === "ongoing") {
			await db
				.update(transactions)
				.set({ status: "declined" })
				.where(eq(transactions.id, existingTransaction.id));

			console.log("Checkout session marked as expired", {
				eventId,
				checkoutId: checkoutSession.id,
			});
		}

		return new Response(null, { status: 200 });
	} catch (error: any) {
		console.error("Failed to process expired session:", {
			eventId,
			error: error.message,
		});
		// Don't fail on expired session processing errors
		return new Response(null, { status: 200 });
	}
}

/**
 * Process v2 outbound payment events.
 *
 * Payouts are dispatched through the v2 API
 * (`v2.moneyManagement.outboundPayments.create`) and stored with the
 * OutboundPayment ID. Stripe emits `v2.money_management.outbound_payment.*`
 * thin events for them, which reference the object via `related_object.id`.
 * The previous v1 `payout.*` handlers matched on `payout.id` and could never
 * resolve the row, so payouts stayed `processing` and failed payouts never
 * restored the creator's balance.
 */
type OutboundPaymentEvent = {
	type: string;
	related_object?: { id?: string | null } | null;
	fetchRelatedObject?: () => Promise<unknown>;
};

async function handleOutboundPaymentEvent(
	event: OutboundPaymentEvent,
	eventId: string,
): Promise<Response> {
	// Status mapping lives in lib/payouts so it is unit-tested.
	const targetStatus = mapOutboundPaymentEvent(event.type);
	if (!targetStatus) {
		return new Response(null, { status: 200 });
	}

	const outboundPaymentId = event.related_object?.id;
	if (!outboundPaymentId) {
		console.error("Outbound payment event without related_object", {
			eventId,
			eventType: event.type,
		});
		return new Response("Missing related object", { status: 400 });
	}

	try {
		const existingPayout = await db.query.payouts.findFirst({
			where: eq(payouts.stripePayoutId, outboundPaymentId),
		});

		if (!existingPayout) {
			console.log("Outbound payment not found for event", {
				eventId,
				outboundPaymentId,
			});
			return new Response(null, { status: 200 });
		}

		// Idempotency: success and terminal failure states are sticky.
		if (existingPayout.status === targetStatus) {
			return new Response("Event already processed", { status: 200 });
		}
		if (
			existingPayout.status === "completed" ||
			existingPayout.status === "cancelled"
		) {
			return new Response("Payout already finalised", { status: 200 });
		}

		// Fetch the object only for failure details; the status is authoritative
		// from the event type itself.
		let failureCode: string | null = null;
		let failureMessage: string | null = null;
		if (targetStatus === "failed") {
			try {
				const payment = await event.fetchRelatedObject?.();
				const details = (
					payment as {
						status_details?: {
							code?: string;
							reason?: { code?: string; reason?: string };
						};
					}
				)?.status_details;
				failureCode = details?.reason?.code ?? details?.code ?? null;
				failureMessage = details?.reason?.reason ?? null;
			} catch (error) {
				console.error("Failed to fetch outbound payment details", {
					eventId,
					outboundPaymentId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		await db.transaction(async (tx) => {
			await tx
				.update(payouts)
				.set({
					status: targetStatus,
					...(targetStatus === "completed"
						? { completedAt: new Date() }
						: {
								failureCode,
								failureMessage,
							}),
				})
				.where(eq(payouts.id, existingPayout.id));

			// A payout that never posted must give the reserved funds back.
			if (targetStatus !== "completed") {
				const existingRestoration = await tx.query.earningsLedger.findFirst({
					where: and(
						eq(earningsLedger.userId, existingPayout.userId),
						eq(earningsLedger.relatedPayoutId, existingPayout.id),
						eq(earningsLedger.transactionType, "adjustment"),
					),
				});

				if (!existingRestoration) {
					await tx.insert(earningsLedger).values({
						userId: existingPayout.userId,
						transactionType: "adjustment",
						amount: existingPayout.amount,
						relatedPayoutId: existingPayout.id,
						description: `Restored balance due to ${targetStatus} payout ${existingPayout.id}`,
					});
				}
			}
		});

		console.log(`Payout marked as ${targetStatus}`, {
			eventId,
			outboundPaymentId,
			payoutId: existingPayout.id,
			restoredBalance: targetStatus !== "completed",
		});

		return new Response(null, { status: 200 });
	} catch (error: any) {
		console.error("Failed to process outbound payment event:", {
			eventId,
			outboundPaymentId,
			error: error.message,
		});
		return new Response(`Webhook Error: ${error.message}`, { status: 500 });
	}
}

/**
 * Process account.updated event
 * Updates Stripe Connect account status when account details change
 */
async function handleAccountUpdated(
	account: Stripe.Account,
	eventId: string
): Promise<Response> {
	try {
		// Find the Connect account in our database
		const existingAccount = await db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.stripeAccountId, account.id),
		});

		if (!existingAccount) {
			console.log("Connect account not found in database", {
				eventId,
				accountId: account.id,
			});
			return new Response(null, { status: 200 });
		}

		// Determine the status
		let status: StripeConnectStatus = "pending";
		if (account.details_submitted) {
			if (account.charges_enabled && account.payouts_enabled) {
				status = "active";
			} else if (
				account.requirements?.disabled_reason ||
				(account.requirements?.currently_due?.length ?? 0) > 0
			) {
				status = "restricted";
			}
		}

		// Update the database
		await db
			.update(stripeConnectAccounts)
			.set({
				status,
				chargesEnabled: account.charges_enabled || false,
				payoutsEnabled: account.payouts_enabled || false,
				detailsSubmitted: account.details_submitted || false,
				country: account.country,
				defaultCurrency: account.default_currency,
				updatedAt: new Date(),
			})
			.where(eq(stripeConnectAccounts.stripeAccountId, account.id));

		console.log("Connect account updated", {
			eventId,
			accountId: account.id,
			status,
			chargesEnabled: account.charges_enabled,
			payoutsEnabled: account.payouts_enabled,
		});

		return new Response(null, { status: 200 });
	} catch (error: any) {
		console.error("Failed to process account.updated:", {
			eventId,
			accountId: account.id,
			error: error.message,
		});
		return new Response(`Webhook Error: ${error.message}`, { status: 500 });
	}
}

export async function POST(req: Request) {
	if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_PURCHASES) {
		return new Response("Stripe is not configured", { status: 500 });
	}

	const body = await req.text();
	const headersList = await headers();
	const signature = headersList.get("Stripe-Signature")!;

	let event: Stripe.Event;
	try {
		const stripe = getStripe();
		event = stripe.webhooks.constructEvent(
			body,
			signature,
			process.env.STRIPE_WEBHOOK_PURCHASES,
		);
	} catch (error: any) {
		console.error("Webhook signature verification failed.", error.message);
		return new Response(`Webhook Error: ${error.message}`, { status: 400 });
	}

	const session = (event as { data?: { object: unknown } }).data?.object;
	const eventId = event.id;

	console.log("Processing Stripe webhook", {
		eventId,
		eventType: event.type,
	});

	// v2 thin events reference their object instead of embedding it, so they
	// have no `data.object` and must be dispatched separately.
	if (event.type.startsWith("v2.")) {
		return handleOutboundPaymentEvent(
			event as unknown as OutboundPaymentEvent,
			eventId,
		);
	}

	switch (event.type) {
		case "checkout.session.completed":
			return handleCheckoutCompleted(
				session as Stripe.Checkout.Session,
				eventId
			);

		case "checkout.session.expired":
			return handleCheckoutExpired(
				session as Stripe.Checkout.Session,
				eventId
			);

		case "account.updated":
			return handleAccountUpdated(session as Stripe.Account, eventId);

		default:
			console.log("Unhandled webhook event type", { eventType: event.type });
			return new Response(null, { status: 200 });
	}
}
