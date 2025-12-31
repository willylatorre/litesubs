import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/app/db";
import { liteSubscriptions, transactions } from "@/app/db/schema";
import { earningsLedger, payouts } from "@/app/db/payouts-schema";
import { getStripe } from "@/lib/stripe";
import type { Stripe } from "stripe";

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

	const session = event.data.object as any;

	if (event.type === "checkout.session.completed") {
		const checkoutSession = session as Stripe.Checkout.Session;
		const metadata = checkoutSession.metadata;

		if (!metadata?.userId || !metadata?.productId) {
			console.error("Webhook received with missing metadata");
			return new Response("Missing metadata", { status: 400 });
		}

		try {
			// Idempotency check
			const existingTransaction = await db.query.transactions.findFirst({
				where: eq(transactions.stripeCheckoutId, checkoutSession.id),
			});
			
			if (existingTransaction && existingTransaction.status === "completed") {
				return new Response("Webhook already processed.", { status: 200 });
			}

			const creditsToAdd = Number(metadata.credits);

			await db.transaction(async (tx) => {
				const subscription = await tx.query.liteSubscriptions.findFirst({
					where: and(
						eq(liteSubscriptions.userId, metadata.userId),
						eq(liteSubscriptions.productId, metadata.productId),
					),
				});

				if (!subscription) {
					// This case should ideally not happen if a subscription is created upon invite acceptance
					// But as a fallback, we could create one.
					await tx.insert(liteSubscriptions).values({
						userId: metadata.userId,
						productId: metadata.productId,
						creatorId: metadata.creatorId,
						credits: creditsToAdd,
					});
				} else {
					await tx
						.update(liteSubscriptions)
						.set({
							credits: sql`${liteSubscriptions.credits} + ${creditsToAdd}`,
						})
						.where(eq(liteSubscriptions.id, subscription.id));
				}

				// Update or Insert transaction
				if (existingTransaction) {
					await tx
						.update(transactions)
						.set({
							status: "completed",
							amountMoney: checkoutSession.amount_total ?? existingTransaction.amountMoney,
							currency: (checkoutSession.currency as any) ?? existingTransaction.currency,
						})
						.where(eq(transactions.id, existingTransaction.id));
				} else {
					// Fallback: create if it doesn't exist
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
					});
				}

				// Add to Earnings Ledger
				if (metadata.creatorId && checkoutSession.amount_total) {
					await tx.insert(earningsLedger).values({
						userId: metadata.creatorId,
						transactionType: "sale",
						amount: (checkoutSession.amount_total / 100).toFixed(2),
						currency: checkoutSession.currency || "usd",
						relatedPaymentIntentId: checkoutSession.payment_intent as string,
						description: `Sale of ${creditsToAdd} credits`,
					});
				}
			});
		} catch (error: any) {
			console.error("Failed to process webhook:", error);
			return new Response(`Webhook Error: ${error.message}`, { status: 500 });
		}
	} else if (event.type === "checkout.session.expired") {
		// Handle expired session (user didn't complete payment)
		const checkoutSession = session as Stripe.Checkout.Session;
		try {
			const existingTransaction = await db.query.transactions.findFirst({
				where: eq(transactions.stripeCheckoutId, checkoutSession.id),
			});

			if (existingTransaction && existingTransaction.status === "ongoing") {
				await db
					.update(transactions)
					.set({
						status: "declined", // or "expired", but user requested "declined" for rejection
					})
					.where(eq(transactions.id, existingTransaction.id));
			}
		} catch (error: any) {
			console.error("Failed to process expired session:", error);
		}
	} else if (event.type === "payout.paid") {
		const payout = session as Stripe.Payout;
		await db
			.update(payouts)
			.set({
				status: "completed",
				completedAt: new Date(),
			})
			.where(eq(payouts.stripePayoutId, payout.id));
	} else if (event.type === "payout.failed" || event.type === "payout.canceled") {
		const payout = session as Stripe.Payout;
		const status = event.type === "payout.failed" ? "failed" : "cancelled";
		
		const existingPayout = await db.query.payouts.findFirst({
			where: eq(payouts.stripePayoutId, payout.id),
		});

		if (existingPayout && existingPayout.status !== status) {
			await db.transaction(async (tx) => {
				await tx
					.update(payouts)
					.set({
						status: status,
						failureCode: payout.failure_code,
						failureMessage: payout.failure_message,
					})
					.where(eq(payouts.stripePayoutId, payout.id));

				// Restore balance by adding a positive adjustment to ledger
				await tx.insert(earningsLedger).values({
					userId: existingPayout.userId,
					transactionType: "adjustment",
					amount: existingPayout.amount, // amount is decimal string
					relatedPayoutId: existingPayout.id,
					description: `Restored balance due to ${status} payout ${existingPayout.id}`,
				});
			});
		}
	}

	return new Response(null, { status: 200 });
}
