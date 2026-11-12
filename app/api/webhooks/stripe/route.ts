import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { Stripe } from "stripe";
import { db } from "@/app/db";
import { planVersions, subscriptions } from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { deriveReadiness } from "@/lib/connect-readiness";
import { markAccountDeauthorized } from "@/lib/services/connect";
import {
	attachStripeSubscription,
	closePayment,
	closeSubscriptionCheckout,
	fulfillPayment,
	fulfillSubscriptionInvoice,
	getPayment,
	markSubscriptionInvoiceFailed,
} from "@/lib/services/purchase";
import { applyPaymentRefund } from "@/lib/services/refunds";
import {
	cancellationEffectiveAt,
	syncSubscriptionFromStripe,
} from "@/lib/services/subscriptions";
import { getStripe } from "@/lib/stripe";
import {
	connectedPaymentIdForIntent,
	listConnectedChargeRefunds,
} from "@/lib/stripe-refunds";
import { retrieveConnectedSubscription } from "@/lib/stripe-subscriptions";

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
	if (checkoutSession.mode === "subscription")
		return handleSubscriptionCheckoutCompleted(
			checkoutSession,
			eventId,
			eventAccountId,
		);
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

async function handleSubscriptionCheckoutCompleted(
	checkoutSession: Stripe.Checkout.Session,
	eventId: string,
	eventAccountId?: string,
): Promise<Response> {
	const localId = checkoutSession.metadata?.subscriptionId;
	if (!localId) return new Response(null, { status: 200 });
	if (checkoutSession.livemode)
		return new Response("Monthly subscriptions are test-mode only", {
			status: 400,
		});
	const stripeSubscriptionId =
		typeof checkoutSession.subscription === "string"
			? checkoutSession.subscription
			: (checkoutSession.subscription?.id ?? null);
	if (!stripeSubscriptionId) {
		console.error("Subscription Checkout missing correlation data", {
			eventId,
		});
		return new Response("Missing subscription metadata", { status: 400 });
	}
	try {
		const subscription = await db.query.subscriptions.findFirst({
			where: and(
				eq(subscriptions.id, localId),
				eq(subscriptions.stripeCheckoutId, checkoutSession.id),
			),
		});
		if (!subscription)
			return new Response("Unknown subscription", { status: 400 });
		const accountId = eventAccountId ?? subscription.stripeAccountId;
		if (accountId !== subscription.stripeAccountId)
			return new Response("Account mismatch", { status: 400 });
		const owner = await db.query.connectedAccounts.findFirst({
			where: eq(connectedAccounts.stripeAccountId, accountId),
		});
		if (
			!owner ||
			owner.userId !== subscription.creatorId ||
			owner.livemode !== false
		)
			return new Response("Account mismatch", { status: 400 });
		const customerId =
			typeof checkoutSession.customer === "string"
				? checkoutSession.customer
				: (checkoutSession.customer?.id ?? null);
		if (customerId !== subscription.stripeCustomerId)
			return new Response("Customer mismatch", { status: 400 });

		await attachStripeSubscription({
			subscriptionId: localId,
			checkoutSessionId: checkoutSession.id,
			stripeSubscriptionId,
			stripeAccountId: accountId,
		});
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to attach Stripe subscription", {
			eventId,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return new Response("Webhook Error", { status: 500 });
	}
}

type SubscriptionInvoiceContext = {
	localSubscriptionId: string;
	stripeSubscriptionId: string;
	stripeAccountId: string;
	periodStart: Date;
	periodEnd: Date;
	billingReason: "subscription_create" | "subscription_cycle";
};

/** Resolve only the exact immutable monthly Price line for a Litesubs subscription. */
async function subscriptionInvoiceContext(
	invoice: Stripe.Invoice,
	eventId: string,
	eventAccountId?: string,
): Promise<SubscriptionInvoiceContext | null | Response> {
	const billingReason = invoice.billing_reason;
	if (
		billingReason !== "subscription_create" &&
		billingReason !== "subscription_cycle"
	)
		return null;
	const supportedBillingReason = billingReason as
		| "subscription_create"
		| "subscription_cycle";
	const details = invoice.parent?.subscription_details;
	const stripeSubscriptionId = details
		? typeof details.subscription === "string"
			? details.subscription
			: details.subscription.id
		: null;
	const localId = details?.metadata?.subscriptionId;
	// This connected account may also create subscriptions outside Litesubs.
	if (!localId) return null;
	if (invoice.livemode)
		return new Response("Monthly subscriptions are test-mode only", {
			status: 400,
		});
	if (!stripeSubscriptionId)
		return new Response("Missing subscription metadata", { status: 400 });

	const subscription = await db.query.subscriptions.findFirst({
		where: eventAccountId
			? and(
					eq(subscriptions.id, localId),
					eq(subscriptions.stripeAccountId, eventAccountId),
				)
			: eq(subscriptions.id, localId),
	});
	// invoice.paid can arrive before checkout.session.completed; returning 500
	// asks Stripe to retry until the local subscription can be reconciled.
	if (!subscription) {
		console.error("Invoice has no matching local subscription", {
			eventId,
			stripeSubscriptionId,
		});
		return new Response("Unknown subscription", { status: 500 });
	}
	const accountId = eventAccountId ?? subscription.stripeAccountId;
	if (accountId !== subscription.stripeAccountId)
		return new Response("Account mismatch", { status: 400 });
	const owner = await db.query.connectedAccounts.findFirst({
		where: eq(connectedAccounts.stripeAccountId, accountId),
	});
	if (
		!owner ||
		owner.userId !== subscription.creatorId ||
		owner.livemode !== false
	)
		return new Response("Account mismatch", { status: 400 });
	const customerId =
		typeof invoice.customer === "string"
			? invoice.customer
			: (invoice.customer?.id ?? null);
	if (customerId !== subscription.stripeCustomerId)
		return new Response("Customer mismatch", { status: 400 });

	const version = await db.query.planVersions.findFirst({
		where: eq(planVersions.id, subscription.planVersionId),
	});
	if (!version?.stripePriceId || !version.stripeAccountId)
		return new Response("Plan price missing", { status: 400 });
	const matchingLines = invoice.lines.data.filter((line) => {
		const parent = line.parent;
		if (
			parent?.type !== "subscription_item_details" ||
			parent.subscription_item_details?.proration ||
			parent.subscription_item_details?.subscription !== stripeSubscriptionId
		)
			return false;
		const price = line.pricing?.price_details?.price;
		return (
			(typeof price === "string" ? price : price?.id) === version.stripePriceId
		);
	});
	if (version.stripeAccountId !== accountId || matchingLines.length !== 1)
		return new Response("Invoice does not match the published plan", {
			status: 400,
		});
	const line = matchingLines[0];
	if (line.period.end <= line.period.start)
		return new Response("Invalid invoice period", { status: 400 });
	if (invoice.currency !== version.currency)
		return new Response("Invoice currency mismatch", { status: 400 });
	return {
		localSubscriptionId: localId,
		stripeSubscriptionId,
		stripeAccountId: accountId,
		periodStart: new Date(line.period.start * 1000),
		periodEnd: new Date(line.period.end * 1000),
		billingReason: supportedBillingReason,
	};
}

/**
 * The invoice's default PaymentIntent, when Stripe exposes it. A refund on the
 * charge carries this id, so it is the link back to the invoice receipt.
 */
function invoicePaymentIntentId(invoice: Stripe.Invoice) {
	const payment = invoice.payments?.data.find(
		(item) =>
			item.payment.type === "payment_intent" &&
			item.payment.payment_intent !== undefined,
	)?.payment.payment_intent;
	if (!payment) return null;
	return typeof payment === "string" ? payment : payment.id;
}

async function handleInvoicePaid(
	invoice: Stripe.Invoice,
	eventId: string,
	eventAccountId?: string,
): Promise<Response> {
	if (invoice.status !== "paid")
		return new Response("Invoice not paid", { status: 200 });
	try {
		const context = await subscriptionInvoiceContext(
			invoice,
			eventId,
			eventAccountId,
		);
		if (!context) return new Response(null, { status: 200 });
		if (context instanceof Response) return context;
		await fulfillSubscriptionInvoice({
			subscriptionId: context.localSubscriptionId,
			stripeSubscriptionId: context.stripeSubscriptionId,
			stripeAccountId: context.stripeAccountId,
			stripeInvoiceId: invoice.id,
			stripePaymentIntentId: invoicePaymentIntentId(invoice),
			billingReason: context.billingReason,
			amountPaid: invoice.amount_paid,
			currency: invoice.currency,
			periodStart: context.periodStart,
			periodEnd: context.periodEnd,
			paidAt: new Date(
				(invoice.status_transitions.paid_at ?? Date.now() / 1000) * 1000,
			),
		});
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to process subscription invoice", {
			eventId,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return new Response("Webhook Error", { status: 500 });
	}
}

async function handleInvoicePaymentFailed(
	invoice: Stripe.Invoice,
	eventId: string,
	eventAccountId?: string,
): Promise<Response> {
	try {
		const context = await subscriptionInvoiceContext(
			invoice,
			eventId,
			eventAccountId,
		);
		if (!context) return new Response(null, { status: 200 });
		if (context instanceof Response) return context;
		await markSubscriptionInvoiceFailed({
			subscriptionId: context.localSubscriptionId,
			stripeSubscriptionId: context.stripeSubscriptionId,
			stripeAccountId: context.stripeAccountId,
			stripeInvoiceId: invoice.id,
			billingReason: context.billingReason,
			periodStart: context.periodStart,
			periodEnd: context.periodEnd,
		});
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to process failed subscription invoice", {
			eventId,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return new Response("Webhook Error", { status: 500 });
	}
}

async function handleSubscriptionLifecycle(
	eventSubscription: Stripe.Subscription,
	eventType: "customer.subscription.updated" | "customer.subscription.deleted",
	eventId: string,
	eventLivemode: boolean,
	eventAccountId?: string,
): Promise<Response> {
	if (!eventAccountId) return new Response(null, { status: 200 });
	const metadataSubscriptionId = eventSubscription.metadata.subscriptionId;
	try {
		const byStripeId = await db.query.subscriptions.findFirst({
			where: and(
				eq(subscriptions.stripeAccountId, eventAccountId),
				eq(subscriptions.stripeSubscriptionId, eventSubscription.id),
			),
		});
		const subscription =
			byStripeId ??
			(metadataSubscriptionId
				? await db.query.subscriptions.findFirst({
						where: and(
							eq(subscriptions.id, metadataSubscriptionId),
							eq(subscriptions.stripeAccountId, eventAccountId),
						),
					})
				: undefined);
		if (!subscription) return new Response(null, { status: 200 });
		if (metadataSubscriptionId && metadataSubscriptionId !== subscription.id)
			return new Response("Subscription metadata mismatch", { status: 400 });

		const owner = await db.query.connectedAccounts.findFirst({
			where: eq(connectedAccounts.stripeAccountId, eventAccountId),
		});
		if (
			!owner ||
			owner.userId !== subscription.creatorId ||
			owner.livemode !== false ||
			eventLivemode
		)
			return new Response("Account mismatch", { status: 400 });
		const eventCustomerId =
			typeof eventSubscription.customer === "string"
				? eventSubscription.customer
				: eventSubscription.customer.id;
		if (eventCustomerId !== subscription.stripeCustomerId)
			return new Response("Customer mismatch", { status: 400 });

		// Updated events may arrive out of order. Retrieve current Stripe state;
		// deleted events are already authoritative terminal snapshots.
		const current =
			eventType === "customer.subscription.deleted"
				? eventSubscription
				: await retrieveConnectedSubscription({
						stripeAccountId: eventAccountId,
						stripeSubscriptionId: eventSubscription.id,
					});
		if (
			current.id !== eventSubscription.id ||
			(subscription.stripeSubscriptionId &&
				current.id !== subscription.stripeSubscriptionId)
		)
			return new Response("Subscription mismatch", { status: 400 });
		const currentCustomerId =
			typeof current.customer === "string"
				? current.customer
				: current.customer.id;
		if (currentCustomerId !== subscription.stripeCustomerId)
			return new Response("Customer mismatch", { status: 400 });
		if (
			current.metadata.subscriptionId &&
			current.metadata.subscriptionId !== subscription.id
		)
			return new Response("Subscription metadata mismatch", { status: 400 });

		await syncSubscriptionFromStripe({
			subscriptionId: subscription.id,
			stripeSubscriptionId: current.id,
			stripeAccountId: eventAccountId,
			stripeCustomerId: currentCustomerId,
			stripeStatus: current.status,
			cancelAtPeriodEnd: current.cancel_at_period_end,
			cancelAt: cancellationEffectiveAt(current),
		});
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to sync Stripe subscription lifecycle", {
			eventId,
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
		await closeSubscriptionCheckout(checkoutSession.id);
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
	livemode: boolean,
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
				livemode,
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

/**
 * The charge was refunded in the creator's Stripe Dashboard. Stripe owns the
 * money movement; this reconciles the receipt and revokes only the unspent
 * units attributable to that specific purchase.
 *
 * `amount_refunded` on the charge is cumulative, so individual refunds are
 * listed on the owning account and deduplicated by their stable refund id.
 * Relying on the event total alone would replay earlier refunds.
 */
async function handleChargeRefunded(
	charge: Stripe.Charge,
	eventId: string,
	eventAccountId?: string,
): Promise<Response> {
	if (!eventAccountId) return new Response(null, { status: 200 });
	if ((charge.amount_refunded ?? 0) <= 0)
		return new Response(null, { status: 200 });

	const paymentIntentId =
		typeof charge.payment_intent === "string"
			? charge.payment_intent
			: (charge.payment_intent?.id ?? null);
	try {
		// A refund can beat the confirming webhook. The PaymentIntent metadata
		// written at Checkout creation still identifies the local receipt.
		const fallbackPaymentId = paymentIntentId
			? await connectedPaymentIdForIntent({
					stripeAccountId: eventAccountId,
					paymentIntentId,
				})
			: null;
		const list = await listConnectedChargeRefunds({
			stripeAccountId: eventAccountId,
			stripeChargeId: charge.id,
		});
		let recorded = 0;
		for (const refund of list) {
			if (refund.status !== "succeeded" || refund.amount <= 0) continue;
			const result = await applyPaymentRefund({
				stripeAccountId: eventAccountId,
				stripeRefundId: refund.id,
				amount: refund.amount,
				currency: refund.currency,
				paymentIntentId,
				fallbackPaymentId,
			});
			if (result.status === "recorded") recorded += 1;
		}
		console.log("Reconciled charge refunds", {
			eventId,
			chargeId: charge.id,
			recorded,
		});
		return new Response(null, { status: 200 });
	} catch (error) {
		console.error("Failed to reconcile refund", {
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
		case "invoice.paid":
			return handleInvoicePaid(
				object as Stripe.Invoice,
				eventId,
				event.account ?? undefined,
			);
		case "invoice.payment_failed":
		case "invoice.payment_action_required":
			return handleInvoicePaymentFailed(
				object as Stripe.Invoice,
				eventId,
				event.account ?? undefined,
			);
		case "customer.subscription.updated":
		case "customer.subscription.deleted":
			return handleSubscriptionLifecycle(
				object as Stripe.Subscription,
				event.type,
				eventId,
				event.livemode,
				event.account ?? undefined,
			);
		case "charge.refunded":
			return handleChargeRefunded(
				object as Stripe.Charge,
				eventId,
				event.account ?? undefined,
			);
		case "account.updated":
			return handleAccountUpdated(
				object as Stripe.Account,
				eventId,
				event.livemode,
			);
		case "account.application.deauthorized":
			return handleApplicationDeauthorized(event, eventId);
		default:
			return new Response(null, { status: 200 });
	}
}
