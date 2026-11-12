import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { Stripe } from "stripe";
import { db } from "@/app/db";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { deriveReadiness } from "@/lib/connect-readiness";
import { markAccountDeauthorized } from "@/lib/services/connect";
import {
	closePayment,
	fulfillPayment,
	getPayment,
} from "@/lib/services/purchase";
import { getStripe } from "@/lib/stripe";

/**
 * Fulfil a paid one-time Checkout.
 *
 * Credits come only from a confirmed payment, never from the success page. The
 * service's `pending -> paid` transition is the idempotency boundary, so
 * duplicate and concurrent deliveries grant once.
 */
async function handleCheckoutCompleted(
	checkoutSession: Stripe.Checkout.Session,
	eventId: string,
	eventAccountId?: string,
): Promise<Response> {
	const metadata = checkoutSession.metadata;
	if (!metadata?.paymentId || !metadata?.creatorId) {
		console.error("Webhook received with missing metadata", { eventId });
		return new Response("Missing metadata", { status: 400 });
	}

	// The session must report a confirmed payment before anything is granted.
	if (checkoutSession.payment_status !== "paid")
		return new Response("Payment not confirmed", { status: 200 });

	try {
		const payment = await getPayment(metadata.paymentId);
		if (!payment) {
			console.error("Checkout payment row not found", { eventId });
			return new Response("Unknown payment", { status: 400 });
		}

		// For a direct charge the event is scoped to the connected account, so
		// `event.account` is authoritative. Metadata is correlation data and must
		// not be able to point the receipt at a different account.
		const accountId = eventAccountId ?? payment.stripeAccountId;
		if (accountId !== payment.stripeAccountId) {
			console.error("Checkout account does not match the payment", {
				eventId,
				accountId,
				expected: payment.stripeAccountId,
			});
			return new Response("Account mismatch", { status: 400 });
		}
		if (eventAccountId) {
			const owner = await db.query.connectedAccounts.findFirst({
				where: eq(connectedAccounts.stripeAccountId, eventAccountId),
			});
			// A direct-charge event from an account we do not have mapped to this
			// creator is not ours to fulfil.
			if (!owner || owner.userId !== payment.creatorId) {
				console.error("Direct charge came from an unmapped account", {
					eventId,
					eventAccountId,
					creatorId: payment.creatorId,
				});
				return new Response("Account mismatch", { status: 400 });
			}
		}
		// The charge must be at least the intended total; charging less than the
		// receipt says is a mismatch, not a discount to compute credits from.
		if ((checkoutSession.amount_total ?? 0) < payment.amountTotal) {
			console.error("Checkout charged less than the receipt", {
				eventId,
				charged: checkoutSession.amount_total,
				expected: payment.amountTotal,
			});
			return new Response("Amount mismatch", { status: 400 });
		}

		const paymentIntent =
			typeof checkoutSession.payment_intent === "string"
				? checkoutSession.payment_intent
				: (checkoutSession.payment_intent?.id ?? null);
		const result = await fulfillPayment({
			checkoutSessionId: checkoutSession.id,
			amountPaid: checkoutSession.amount_total ?? payment.amountTotal,
			paymentIntentId: paymentIntent,
		});
		if (result.status === "already_fulfilled")
			return new Response("Event already processed", { status: 200 });
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to process checkout webhook", {
			eventId,
			checkoutId: checkoutSession.id,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return new Response("Webhook Error", { status: 500 });
	}
}

async function handleCheckoutExpired(
	checkoutSession: Stripe.Checkout.Session,
	eventId: string,
): Promise<Response> {
	try {
		await closePayment(checkoutSession.id, "expired");
		console.log("Checkout session expired", { eventId });
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to process expired session", {
			eventId,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return new Response(null, { status: 200 });
	}
}

async function handleAccountUpdated(
	account: Stripe.Account,
	eventId: string,
): Promise<Response> {
	try {
		const existingAccount = await db.query.connectedAccounts.findFirst({
			where: eq(connectedAccounts.stripeAccountId, account.id),
		});
		if (!existingAccount) return new Response(null, { status: 200 });

		// `account.updated` carries a full snapshot, so the same derivation the
		// service uses applies here; readiness never becomes "sellable" because
		// an event arrived.
		const readiness = deriveReadiness(account);
		await db
			.update(connectedAccounts)
			.set({
				status: readiness.status,
				chargesEnabled: readiness.chargesEnabled,
				payoutsEnabled: readiness.payoutsEnabled,
				cardPaymentsStatus: account.capabilities?.card_payments ?? null,
				detailsSubmitted: readiness.detailsSubmitted,
				country: account.country,
				defaultCurrency: account.default_currency,
				requirementsCurrentlyDue: readiness.requirementsDue,
				requirementsDisabledReason: readiness.disabledReason,
				lastSyncedAt: new Date(),
			})
			.where(eq(connectedAccounts.stripeAccountId, account.id));

		console.log("Connected account updated", {
			eventId,
			accountId: account.id,
			status: readiness.status,
		});
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to process account.updated", {
			eventId,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return new Response("Webhook Error", { status: 500 });
	}
}

/**
 * A creator revoked Litesubs' access from their Stripe Dashboard. New sales
 * must stop immediately, and their account identity must survive on every
 * historical record (which is why only the connection row is updated).
 *
 * The event's object is an `application`, not an account, so the account comes
 * from the event's top-level `account` field.
 */
async function handleApplicationDeauthorized(
	event: Stripe.Event,
	eventId: string,
): Promise<Response> {
	// `data.object` is the platform *application*, not the account. Stripe puts
	// the deauthorized account on the event's top-level `account` field, so
	// reading the object would silently miss every real event.
	const target = event.account?.startsWith("acct_") ? event.account : undefined;
	if (!target) {
		console.error("Deauthorization event without an account id", { eventId });
		return new Response(null, { status: 200 });
	}
	try {
		const result = await markAccountDeauthorized(target);
		console.log("Connected account deauthorized", {
			eventId,
			accountId: target,
			handled: result.handled,
		});
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to process deauthorization", {
			eventId,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return new Response("Webhook Error", { status: 500 });
	}
}

export async function POST(req: Request) {
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!process.env.STRIPE_SECRET_KEY || !secret)
		return new Response("Stripe is not configured", { status: 500 });

	const body = await req.text();
	const headersList = await headers();
	const signature = headersList.get("Stripe-Signature");
	if (!signature) return new Response("Missing signature", { status: 400 });

	let event: Stripe.Event;
	try {
		event = getStripe().webhooks.constructEvent(body, signature, secret);
	} catch {
		return new Response("Invalid signature", { status: 400 });
	}

	const object = (event as { data?: { object: unknown } }).data?.object;
	const eventId = event.id;

	switch (event.type) {
		case "checkout.session.completed":
			return handleCheckoutCompleted(
				object as Stripe.Checkout.Session,
				eventId,
				event.account ?? undefined,
			);
		case "checkout.session.async_payment_succeeded":
			return handleCheckoutCompleted(
				object as Stripe.Checkout.Session,
				eventId,
				event.account ?? undefined,
			);
		case "checkout.session.expired":
			return handleCheckoutExpired(object as Stripe.Checkout.Session, eventId);
		case "account.updated":
			return handleAccountUpdated(object as Stripe.Account, eventId);
		case "account.application.deauthorized":
			return handleApplicationDeauthorized(event, eventId);
		default:
			return new Response(null, { status: 200 });
	}
}
