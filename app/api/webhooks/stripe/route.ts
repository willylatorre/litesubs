import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import type { Stripe } from "stripe";
import { db } from "@/app/db";
import {
	enrollments,
	plans,
	planVersions,
	transactions,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { deriveReadiness } from "@/lib/connect-readiness";
import { markAccountDeauthorized } from "@/lib/services/connect";
import { getStripe } from "@/lib/stripe";

/**
 * Fulfil a paid one-time Checkout. Credits come only from a confirmed payment,
 * never from the success page. Locally enforced keys (Checkout session ID)
 * make duplicate and concurrent deliveries grant once.
 */
async function handleCheckoutCompleted(
	checkoutSession: Stripe.Checkout.Session,
	eventId: string,
	eventAccountId?: string,
): Promise<Response> {
	const metadata = checkoutSession.metadata;
	if (!metadata?.planId || !metadata?.creatorId) {
		console.error("Webhook received with missing metadata", { eventId });
		return new Response("Missing metadata", { status: 400 });
	}

	// The session must report a confirmed payment before anything is granted.
	if (checkoutSession.payment_status !== "paid")
		return new Response("Payment not confirmed", { status: 200 });

	try {
		const existing = await db.query.transactions.findFirst({
			where: eq(transactions.stripeCheckoutId, checkoutSession.id),
		});
		if (existing?.status === "completed")
			return new Response("Event already processed", { status: 200 });

		const customerId =
			metadata.userId ??
			(typeof checkoutSession.customer_email === "string"
				? await resolveUserIdByEmail(checkoutSession.customer_email)
				: null);
		if (!customerId) {
			console.error("Checkout has no resolvable customer", { eventId });
			return new Response("Missing customer", { status: 400 });
		}

		const plan = await db.query.plans.findFirst({
			where: and(
				eq(plans.id, metadata.planId),
				eq(plans.creatorId, metadata.creatorId),
			),
		});
		if (!plan) {
			console.error("Checkout plan not found for creator", {
				eventId,
				planId: metadata.planId,
			});
			return new Response("Unknown plan", { status: 400 });
		}
		const version = metadata.planVersionId
			? await db.query.planVersions.findFirst({
					where: eq(planVersions.id, metadata.planVersionId),
				})
			: undefined;
		if (!version || version.planId !== plan.id) {
			console.error("Checkout version does not match plan", {
				eventId,
				planId: plan.id,
			});
			return new Response("Unknown plan version", { status: 400 });
		}
		const creditsToAdd = version.credits;
		// For a direct charge the event itself is scoped to the connected account,
		// so `event.account` is authoritative. Metadata is correlation data and
		// must not be able to point the receipt at a different account.
		const accountId = eventAccountId ?? metadata.stripeConnectAccountId ?? null;
		if (eventAccountId) {
			const owner = await db.query.connectedAccounts.findFirst({
				where: eq(connectedAccounts.stripeAccountId, eventAccountId),
			});
			// A direct-charge event from an account we do not have mapped to this
			// creator is not ours to fulfil.
			if (!owner || owner.userId !== plan.creatorId) {
				console.error("Direct charge came from an unmapped account", {
					eventId,
					eventAccountId,
					creatorId: plan.creatorId,
				});
				return new Response("Account mismatch", { status: 400 });
			}
		}
		const applicationFee = metadata.applicationFeeAmount
			? Number.parseInt(metadata.applicationFeeAmount, 10)
			: null;

		await db.transaction(async (tx) => {
			const [enrollment] = await tx
				.insert(enrollments)
				.values({
					userId: customerId,
					planId: plan.id,
					creatorId: plan.creatorId,
				})
				.onConflictDoUpdate({
					target: [enrollments.userId, enrollments.planId],
					set: { updatedAt: new Date() },
				})
				.returning();

			await tx
				.update(enrollments)
				.set({ credits: sql`${enrollments.credits} + ${creditsToAdd}` })
				.where(eq(enrollments.id, enrollment.id));

			// The Checkout session ID is the fulfillment key. A concurrent second
			// delivery hits the unique constraint and rolls back granting twice.
			await tx.insert(transactions).values({
				userId: customerId,
				creatorId: plan.creatorId,
				planId: plan.id,
				amount: creditsToAdd,
				amountMoney: checkoutSession.amount_total,
				currency:
					(checkoutSession.currency as "usd" | "eur") ?? version.currency,
				type: "purchase",
				description: `Purchase of ${creditsToAdd} credits`,
				stripeCheckoutId: checkoutSession.id,
				status: "completed",
				usesStripeConnect: true,
				stripeApplicationFee: applicationFee,
				stripeConnectAccountId: accountId,
				balanceBefore: enrollment.credits,
				balanceAfter: enrollment.credits + creditsToAdd,
			});
		});

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

async function resolveUserIdByEmail(email: string) {
	const { user } = await import("@/app/db/schema");
	const match = await db.query.user.findFirst({ where: eq(user.email, email) });
	return match?.id ?? null;
}

async function handleCheckoutExpired(
	checkoutSession: Stripe.Checkout.Session,
	eventId: string,
): Promise<Response> {
	try {
		const existing = await db.query.transactions.findFirst({
			where: eq(transactions.stripeCheckoutId, checkoutSession.id),
		});
		if (existing?.status === "ongoing") {
			await db
				.update(transactions)
				.set({ status: "declined" })
				.where(eq(transactions.id, existing.id));
		}
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
