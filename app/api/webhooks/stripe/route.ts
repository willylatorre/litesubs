import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/app/db";
import { liteSubscriptions, transactions } from "@/app/db/schema";
import { stripe } from "@/lib/stripe";
import type { Stripe } from "stripe";

export async function POST(req: Request) {
	const body = await req.text();
	const signature = headers().get("Stripe-Signature")!;

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(
			body,
			signature,
			process.env.STRIPE_WEBHOOK_SECRET!,
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
			if (existingTransaction) {
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
					// But as a fallback, we could create one. For now, we'll log an error.
					console.error(
						`Subscription not found for user ${metadata.userId} and product ${metadata.productId}`,
					);
					// Or insert a new subscription if that's the desired behavior:
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

				// Log the transaction
				await tx.insert(transactions).values({
					userId: metadata.userId,
					creatorId: metadata.creatorId,
					productId: metadata.productId,
					amount: creditsToAdd,
					type: "purchase",
					description: `Purchase of ${creditsToAdd} credits`,
					stripeCheckoutId: session.id,
				});
			});
		} catch (error: any) {
			console.error("Failed to process webhook:", error);
			return new Response(`Webhook Error: ${error.message}`, { status: 500 });
		}
	}

	return new Response(null, { status: 200 });
}