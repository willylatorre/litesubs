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
 *
 * **Bounded on purpose.** `for await` over `invoices.list()` auto-paginates
 * through the *entire* history — `limit` is a page size, not a total cap — so a
 * creator with years of invoices would make every refresh walk all of them. We
 * read one page and stop. One page of 100 covers more months than any
 * subscription needs: entitlement only cares about the most recent paid period,
 * and a creator who has not paid in 100 invoices is not premium under any rule.
 *
 * The client is injectable so the "exactly one request" property can be tested
 * without a live account that has long history.
 */
export async function resolvePaidThrough(
	stripeSubscriptionId: string,
	client: Pick<Stripe, "invoices"> = getStripe(),
): Promise<Date | null> {
	// Newest first, which is Stripe's default order for invoices. Called once:
	// no async iteration, so no page 2.
	const page = await client.invoices.list({
		subscription: stripeSubscriptionId,
		limit: 100,
	});
	let furthest: Date | null = null;
	for (const invoice of page.data) {
		const end = paidThroughFromInvoice(invoice);
		if (!end) continue;
		if (!furthest || end.getTime() > furthest.getTime()) furthest = end;
	}
	// A full page with no paid period in it means the paid boundary is older than
	// we looked. That is not "paid forever"; it is "not resolvable from what we
	// read", and the caller treats null as unproven.
	return furthest;
}

/**
 * How long a failed/unproductive boundary resolution is trusted before the read
 * path tries Stripe again.
 *
 * The webhook is the primary repair path and runs on every platform event, so
 * this is only a safety net for a row whose webhook was missed. Six hours is
 * long enough that an abandoned checkout cannot hammer Stripe from dashboard
 * traffic, and short enough that a creator who pays a missed invoice is premium
 * the same day.
 */
export const PAID_THROUGH_RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a read should spend a Stripe call trying to resolve the boundary.
 *
 * Pure, so the rule is testable without a clock and without the network. `null`
 * means "never checked", which is worth one look so a legacy row heals; a recent
 * check that found nothing is not worth repeating.
 */
export function shouldRefreshPaidThrough(
	checkedAt: Date | null,
	now: number,
): boolean {
	if (checkedAt === null) return true;
	return now - checkedAt.getTime() > PAID_THROUGH_RECHECK_MS;
}

/**
 * Refresh the stored boundary for a creator, moving it **forward only**.
 *
 * Monotonic on purpose: an out-of-order or replayed webhook, a failed renewal,
 * or a retry must never pull the boundary back and revoke access that was
 * already granted. Moving it backwards would also make entitlement flicker
 * based on delivery order, which is not something a customer can reason about.
 *
 * If Stripe has no paid invoice at all, the row is **stamped** with the fact
 * that the search happened (`paidThroughCheckedAt`) rather than left null
 * forever. Without that, a creator who started a checkout and abandoned it has
 * `paidThroughAt = null` and no paid invoice, so every dashboard load would call
 * Stripe again, forever, and still find nothing.
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
	const now = new Date();

	// Stamp the attempt either way: `paidThroughCheckedAt` records that we looked,
	// so a null boundary does not mean "retry on every read".
	const advances =
		paidThrough !== null &&
		(!row.paidThroughAt || paidThrough.getTime() > row.paidThroughAt.getTime());
	await db
		.update(subscription)
		.set({
			...(advances ? { paidThroughAt: paidThrough } : {}),
			paidThroughCheckedAt: now,
			updatedAt: now,
		})
		.where(eq(subscription.id, row.id));

	// Forward-only: report the boundary actually stored, which is the older one
	// when a replayed event offers nothing new.
	return advances ? paidThrough : row.paidThroughAt;
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
