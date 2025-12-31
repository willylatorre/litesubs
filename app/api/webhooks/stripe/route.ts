import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/app/db";
import { liteSubscriptions, transactions } from "@/app/db/schema";
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

	const session = event.data.object as Stripe.Checkout.Session;

	if (event.type === "checkout.session.completed") {
		const metadata = session.metadata;

		if (!metadata?.userId || !metadata?.productId) {
			console.error("Webhook received with missing metadata");
			return new Response("Missing metadata", { status: 400 });
		}

		try {
			// Idempotency check
			const existingTransaction = await db.query.transactions.findFirst({
				where: eq(transactions.stripeCheckoutId, session.id),
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
							amountMoney: session.amount_total ?? existingTransaction.amountMoney,
							currency: (session.currency as any) ?? existingTransaction.currency,
						})
						.where(eq(transactions.id, existingTransaction.id));
				} else {
					// Fallback: create if it doesn't exist
					await tx.insert(transactions).values({
						userId: metadata.userId,
						creatorId: metadata.creatorId,
						productId: metadata.productId,
						amount: creditsToAdd,
						amountMoney: session.amount_total,
						currency: session.currency as any,
						type: "purchase",
						description: `Purchase of ${creditsToAdd} credits`,
						stripeCheckoutId: session.id,
						status: "completed",
					});
				}
			});
		} catch (error: any) {
			console.error("Failed to process webhook:", error);
			return new Response(`Webhook Error: ${error.message}`, { status: 500 });
		}
	} else if (event.type === "checkout.session.expired") {
		// Handle expired session (user didn't complete payment)
		try {
			const existingTransaction = await db.query.transactions.findFirst({
				where: eq(transactions.stripeCheckoutId, session.id),
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
	}

	return new Response(null, { status: 200 });
}
