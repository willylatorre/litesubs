import { and, eq, isNotNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/app/db";
import { subscription } from "@/app/db/schema";
import { getStripe } from "@/lib/stripe";

/**
 * Keep `litesub_subscription.paid_through_at` equal to the last period the
 * creator actually paid for.
 *
 * ## Why this cannot be derived from the subscription row
 *
 * Stripe advances `current_period_end` when a renewal period **starts**, before
 * its invoice is paid, and leaves it advanced when the charge then fails. So on
 * a failed renewal the row reads `status = past_due, period_end = <a month the
 * creator never paid for>`. Entitlement reading `period_end` therefore grants a
 * free month to anyone whose card stops working. This was measured against real
 * test-mode Stripe, not inferred.
 *
 * The honest boundary lives in invoice history: the end of the most recent
 * invoice whose `status` is `paid`. That is what this module resolves.
 *
 * ## Why a stored column rather than a live query
 *
 * `getEntitlement` is on the read path of every dashboard page and API call.
 * A Stripe API round-trip there would make entitlement depend on Stripe's
 * latency and availability. The value is refreshed from the webhook instead,
 * where a Stripe call is already being made and an event is the reason to look.
 */

/** Invoice reasons whose lines describe an entitlement period. */
const PERIOD_INVOICES = new Set(["subscription_create", "subscription_cycle"]);

/**
 * The furthest period end covered by a paid invoice.
 *
 * Stripe splits lines for proration and add-ons, so the maximum line end is the
 * period actually extended. Lines are read, not `invoice.period_end`, because a
 * proration invoice has a `period` that is not the subscription's period.
 */
function paidThroughFromInvoice(invoice: Stripe.Invoice): Date | null {
	if (invoice.status !== "paid") return null;
	if (!PERIOD_INVOICES.has(invoice.billing_reason ?? "")) return null;
	let furthest = 0;
	for (const line of invoice.lines.data) {
		if (line.parent?.type !== "subscription_item_details") continue;
		if (line.parent.subscription_item_details?.proration) continue;
		if (line.period.end > furthest) furthest = line.period.end;
	}
	return furthest > 0 ? new Date(furthest * 1000) : null;
}

/**
 * Resolve the paid-through instant for one platform subscription from Stripe.
 *
 * Returns `null` when there is nothing provably paid (no paid invoice yet, or
 * the subscription predates this bookkeeping). The caller must treat `null` as
 * "unknown", never as "paid forever".
 */
export async function resolvePaidThrough(
	stripeSubscriptionId: string,
): Promise<Date | null> {
	const stripe = getStripe();
	let furthest: Date | null = null;
	// A month of history is enough to find the last paid period; a creator who
	// has been unpaid for longer than that is not premium under any rule.
	for await (const invoice of stripe.invoices.list({
		subscription: stripeSubscriptionId,
		limit: 12,
	})) {
		const end = paidThroughFromInvoice(invoice);
		if (!end) continue;
		if (!furthest || end.getTime() > furthest.getTime()) furthest = end;
	}
	return furthest;
}

/**
 * Refresh the stored boundary for a creator, moving it **forward only**.
 *
 * Monotonic on purpose: an out-of-order or replayed webhook, a failed renewal,
 * or a retry must never pull the boundary back and revoke access that was
 * already granted. Moving it backwards would also make entitlement flicker
 * based on delivery order, which is not something a customer can reason about.
 */
export async function refreshPaidThrough(creatorId: string) {
	const [row] = await db
		.select({
			id: subscription.id,
			stripeSubscriptionId: subscription.stripeSubscriptionId,
			paidThroughAt: subscription.paidThroughAt,
		})
		.from(subscription)
		.where(eq(subscription.referenceId, creatorId))
		.limit(1);
	if (!row?.stripeSubscriptionId) return null;

	const paidThrough = await resolvePaidThrough(row.stripeSubscriptionId);
	if (!paidThrough) return null;
	if (row.paidThroughAt && row.paidThroughAt.getTime() >= paidThrough.getTime())
		return row.paidThroughAt;

	await db
		.update(subscription)
		.set({ paidThroughAt: paidThrough, updatedAt: new Date() })
		.where(eq(subscription.id, row.id));
	return paidThrough;
}

/** Find the creator a Stripe subscription belongs to, if it is ours. */
export async function creatorForStripeSubscription(
	stripeSubscriptionId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ referenceId: subscription.referenceId })
		.from(subscription)
		.where(eq(subscription.stripeSubscriptionId, stripeSubscriptionId))
		.limit(1);
	return row?.referenceId ?? null;
}

/**
 * Creator ids whose paid boundary is still unknown.
 *
 * Used by the refresh script and by a lazy repair path. Exposed as a query
 * rather than a loop so the caller decides how much work to do.
 */
export async function creatorsWithUnresolvedPaidThrough(limit = 50) {
	return db
		.select({
			referenceId: subscription.referenceId,
			stripeSubscriptionId: subscription.stripeSubscriptionId,
		})
		.from(subscription)
		.where(
			and(
				isNotNull(subscription.stripeSubscriptionId),
				sql`${subscription.paidThroughAt} is null`,
			),
		)
		.limit(limit);
}
