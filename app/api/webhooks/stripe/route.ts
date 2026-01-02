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
 * Process payout.paid event
 * Marks payout as completed
 */
async function handlePayoutPaid(
	payout: Stripe.Payout,
	eventId: string
): Promise<Response> {
	try {
		// Idempotency: Check current status before updating
		const existingPayout = await db.query.payouts.findFirst({
			where: eq(payouts.stripePayoutId, payout.id),
		});

		// Skip if already completed
		if (existingPayout?.status === "completed") {
			console.log("Payout already marked as completed", {
				eventId,
				payoutId: payout.id,
			});
			return new Response("Event already processed", { status: 200 });
		}

		if (existingPayout) {
			await db
				.update(payouts)
				.set({
					status: "completed",
					completedAt: new Date(),
				})
				.where(eq(payouts.stripePayoutId, payout.id));

			console.log("Payout marked as completed", {
				eventId,
				payoutId: payout.id,
			});
		}

		return new Response(null, { status: 200 });
	} catch (error: any) {
		console.error("Failed to process payout.paid:", {
			eventId,
			payoutId: payout.id,
			error: error.message,
		});
		return new Response(`Webhook Error: ${error.message}`, { status: 500 });
	}
}

/**
 * Process payout.failed or payout.canceled events
 * Marks payout as failed/cancelled and restores balance
 */
async function handlePayoutFailedOrCanceled(
	payout: Stripe.Payout,
	eventType: "payout.failed" | "payout.canceled",
	eventId: string
): Promise<Response> {
	const targetStatus = eventType === "payout.failed" ? "failed" : "cancelled";

	try {
		const existingPayout = await db.query.payouts.findFirst({
			where: eq(payouts.stripePayoutId, payout.id),
		});

		// Idempotency: Skip if already in target status
		if (existingPayout?.status === targetStatus) {
			console.log(`Payout already marked as ${targetStatus}`, {
				eventId,
				payoutId: payout.id,
			});
			return new Response("Event already processed", { status: 200 });
		}

		if (existingPayout && existingPayout.status !== targetStatus) {
			await db.transaction(async (tx) => {
				// Update payout status
				await tx
					.update(payouts)
					.set({
						status: targetStatus,
						failureCode: payout.failure_code,
						failureMessage: payout.failure_message,
					})
					.where(eq(payouts.stripePayoutId, payout.id));

				// Check if balance restoration already exists
				const existingRestoration = await tx.query.earningsLedger.findFirst({
					where: and(
						eq(earningsLedger.userId, existingPayout.userId),
						eq(earningsLedger.relatedPayoutId, existingPayout.id),
						eq(earningsLedger.transactionType, "adjustment"),
					),
				});

				// Only restore balance if not already done
				if (!existingRestoration) {
					await tx.insert(earningsLedger).values({
						userId: existingPayout.userId,
						transactionType: "adjustment",
						amount: existingPayout.amount,
						relatedPayoutId: existingPayout.id,
						description: `Restored balance due to ${targetStatus} payout ${existingPayout.id}`,
					});
				}
			});

			console.log(`Payout marked as ${targetStatus} and balance restored`, {
				eventId,
				payoutId: payout.id,
			});
		}

		return new Response(null, { status: 200 });
	} catch (error: any) {
		console.error(`Failed to process ${eventType}:`, {
			eventId,
			payoutId: payout.id,
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

	const session = event.data.object;
	const eventId = event.id;

	console.log("Processing Stripe webhook", {
		eventId,
		eventType: event.type,
	});

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

		case "payout.paid":
			return handlePayoutPaid(session as Stripe.Payout, eventId);

		case "payout.failed":
		case "payout.canceled":
			return handlePayoutFailedOrCanceled(
				session as Stripe.Payout,
				event.type,
				eventId
			);

		case "account.updated":
			return handleAccountUpdated(session as Stripe.Account, eventId);

		default:
			console.log("Unhandled webhook event type", { eventType: event.type });
			return new Response(null, { status: 200 });
	}
}
