/**
 * Platform billing: the renewal rules, exercised against the real services.
 *
 * These are the failures that cost real money or wrongly revoke access:
 *
 * - a paid renewal must extend what the creator is entitled to;
 * - a **failed** renewal must not grant the period Stripe has already advanced
 *   `current_period_end` to, because nobody paid for it;
 * - a failed renewal must not revoke a period the creator *did* pay for;
 * - a cancelled subscription stays live until its paid period ends.
 *
 * The boundary is stored separately from Stripe's `period_end` for exactly the
 * failed-renewal case. That distinction was measured against test-mode Stripe —
 * see `docs/PLATFORM-BILLING.md` — not assumed.
 *
 * Real services and a real database; Stripe itself is not called, because the
 * question here is what the stored values mean, not what Stripe emits. The
 * emitted-event shape is proven by `scripts/verify-platform-billing.mts`.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import { subscription, user } from "@/app/db/schema";
import {
	deriveEntitlement,
	getEntitlement,
	PREMIUM_PLAN,
} from "@/lib/services/entitlements";

const DAY = 86_400_000;

async function freshCreator() {
	const id = crypto.randomUUID();
	await db.insert(user).values({
		id,
		name: "Billing Creator",
		username: `b${id.slice(0, 8)}`,
		email: `${id}@example.test`,
		emailVerified: true,
	});
	return id;
}

async function writeSubscription(
	creatorId: string,
	values: {
		status: string;
		periodStart: Date;
		periodEnd: Date;
		paidThroughAt: Date | null;
		cancelAtPeriodEnd?: boolean;
	},
) {
	await db.insert(subscription).values({
		id: `sub-${creatorId}`,
		plan: PREMIUM_PLAN,
		referenceId: creatorId,
		stripeSubscriptionId: `stripe-${creatorId}`,
		status: values.status,
		periodStart: values.periodStart,
		periodEnd: values.periodEnd,
		paidThroughAt: values.paidThroughAt,
		cancelAtPeriodEnd: values.cancelAtPeriodEnd ?? false,
	});
}

test("platform billing follows the paid period, not Stripe's advanced one", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const now = Date.now();

	// --- 1. a paid renewal extends entitlement -------------------------
	const paid = await freshCreator();
	await writeSubscription(paid, {
		status: "active",
		periodStart: new Date(now - 30 * DAY),
		periodEnd: new Date(now + 30 * DAY),
		paidThroughAt: new Date(now + 30 * DAY),
	});
	const paidEntitlement = await getEntitlement(paid);
	assert.equal(paidEntitlement.tier, "premium");
	assert.equal(paidEntitlement.status, "active");
	assert.ok(
		(paidEntitlement.paidThroughAt?.getTime() ?? 0) > now,
		"a paid renewal must move the paid-through date into the future",
	);

	// --- 2. the failed-renewal trap ------------------------------------
	// Stripe advanced period_end to a month that was never paid for. A rule
	// reading period_end would grant premium here; reading the paid boundary
	// refuses it while keeping the month that really was paid.
	const failed = await freshCreator();
	await writeSubscription(failed, {
		status: "past_due",
		// The unpaid period Stripe has already moved the row into.
		periodStart: new Date(now - 1 * DAY),
		periodEnd: new Date(now + 29 * DAY),
		// The last invoice that actually settled ended yesterday.
		paidThroughAt: new Date(now - 1 * DAY),
	});
	const failedEntitlement = await getEntitlement(failed);
	assert.equal(
		failedEntitlement.tier,
		"free",
		"the unpaid renewal period must not confer premium",
	);
	assert.equal(failedEntitlement.status, "ended");

	// --- 3. a failure mid-period keeps what was paid -------------------
	const midPeriod = await freshCreator();
	await writeSubscription(midPeriod, {
		status: "past_due",
		periodStart: new Date(now - 10 * DAY),
		periodEnd: new Date(now + 20 * DAY),
		// Paid through the end of the current period; the NEXT one failed.
		paidThroughAt: new Date(now + 20 * DAY),
	});
	const midEntitlement = await getEntitlement(midPeriod);
	assert.equal(
		midEntitlement.tier,
		"premium",
		"a failed renewal must not revoke a period that was already paid for",
	);
	assert.equal(midEntitlement.status, "past_due");

	// --- 4. cancelling keeps the paid period ---------------------------
	const canceled = await freshCreator();
	await writeSubscription(canceled, {
		status: "canceled",
		periodStart: new Date(now - 5 * DAY),
		periodEnd: new Date(now + 25 * DAY),
		paidThroughAt: new Date(now + 25 * DAY),
		cancelAtPeriodEnd: true,
	});
	const canceledEntitlement = await getEntitlement(canceled);
	assert.equal(
		canceledEntitlement.tier,
		"premium",
		"a cancelled subscription is still paid up to its period end",
	);
	assert.equal(canceledEntitlement.status, "canceling");

	// After the period, the same row is free.
	assert.equal(
		deriveEntitlement(
			{
				plan: PREMIUM_PLAN,
				status: "canceled",
				periodEnd: new Date(now + 25 * DAY),
				paidThroughAt: new Date(now + 25 * DAY),
				cancelAtPeriodEnd: true,
			},
			0,
			now + 26 * DAY,
		).tier,
		"free",
	);

	// --- 5. a row written before the column existed --------------------
	// It must read as "nothing provably paid" rather than inheriting
	// `period_end`, which is the value that cannot be trusted.
	const legacy = await freshCreator();
	await writeSubscription(legacy, {
		status: "active",
		periodStart: new Date(now - 5 * DAY),
		periodEnd: new Date(now + 25 * DAY),
		paidThroughAt: null,
	});
	const [legacyRow] = await db
		.select()
		.from(subscription)
		.where(eq(subscription.referenceId, legacy));
	// `getEntitlement` would try to refresh from Stripe for a null boundary; here
	// the derivation is asserted directly so the test stays offline.
	assert.equal(
		deriveEntitlement(legacyRow, 0, now).tier,
		"free",
		"an unresolved paid boundary must not be trusted from period_end",
	);

	// --- cleanup --------------------------------------------------------
	for (const id of [paid, failed, midPeriod, canceled, legacy])
		await db.delete(user).where(eq(user.id, id));
});

/**
 * A null boundary must not become a Stripe call on every page load.
 *
 * Two distinct situations share `paidThroughAt = null`: "not checked yet" and
 * "checked, nothing was paid". An abandoned checkout is the second, and before
 * `paidThroughCheckedAt` existed `getEntitlement` re-queried Stripe every time
 * anyone opened the dashboard, forever, and always found nothing.
 *
 * The read path is gated on a 6h staleness floor. This asserts the gate itself
 * with a controlled clock, because the cost being prevented is an external API
 * call, not a wrong value.
 */
test("an unpaid creator is not re-queried on every read", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const { shouldRefreshPaidThrough } = await import(
		"@/lib/services/platform-billing"
	);

	const now = Date.now();
	const HOUR = 60 * 60 * 1000;

	// Never checked: worth one look, so a legacy row heals on first read.
	assert.equal(shouldRefreshPaidThrough(null, now), true);

	// Checked and nothing was paid: not worth another call yet.
	assert.equal(
		shouldRefreshPaidThrough(new Date(now - 1 * HOUR), now),
		false,
		"an abandoned checkout must not be re-queried on every dashboard load",
	);

	// Checked long ago: worth retrying, so a missed webhook does not strand a
	// creator who has since paid.
	assert.equal(shouldRefreshPaidThrough(new Date(now - 7 * HOUR), now), true);
});

/**
 * `for await` over `invoices.list()` auto-paginates the whole history; `limit`
 * is a page size. This pins the resolver to exactly one request, because a
 * creator with years of invoices would otherwise make every refresh walk all of
 * them. The fake client makes the call count directly observable.
 */
test("paid-through resolution makes exactly one Stripe request", async () => {
	const { resolvePaidThrough } = await import(
		"@/lib/services/platform-billing"
	);
	let calls = 0;
	const client = {
		invoices: {
			list: async () => {
				calls += 1;
				return {
					object: "list" as const,
					url: "/v1/invoices",
					has_more: true,
					data: [
						{
							id: "in_1",
							status: "paid",
							billing_reason: "subscription_cycle",
							lines: {
								data: [
									{
										parent: {
											type: "subscription_item_details",
											subscription_item_details: {
												proration: false,
											},
										},
										period: { end: 1_800_000_000 },
									},
								],
							},
						},
					],
				};
			},
		},
	} as unknown as Parameters<typeof resolvePaidThrough>[1];

	const resolved = await resolvePaidThrough("sub_test", client);
	assert.equal(calls, 1, "must not page through invoice history");
	assert.equal(resolved?.getTime(), 1_800_000_000_000);
});
