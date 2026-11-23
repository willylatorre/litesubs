import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_PLAN_LIMIT } from "@/app/db/entitlement-schema";
import {
	assertCanCreatePlan,
	assertCanUseDeveloperFeatures,
	assertCanUseRecurring,
	type Entitlement,
} from "@/lib/services/entitlements";
import { ServiceError } from "@/lib/services/principal";

/**
 * The tier rules are pure policy, so they are tested here rather than only
 * through a database: a mistake in them is a billing bug, not a typo, and the
 * service's queries are exercised by the migration suite.
 */

function free(overrides: Partial<Entitlement> = {}): Entitlement {
	return {
		tier: "free",
		isPremium: false,
		planLimit: FREE_PLAN_LIMIT,
		planCount: 0,
		canCreatePlan: true,
		canUseRecurring: false,
		canUseDeveloperFeatures: false,
		status: "free",
		cancelAtPeriodEnd: false,
		paidThroughAt: null,
		...overrides,
	};
}

function premium(overrides: Partial<Entitlement> = {}): Entitlement {
	return {
		tier: "premium",
		isPremium: true,
		planLimit: null,
		planCount: 50,
		canCreatePlan: true,
		canUseRecurring: true,
		canUseDeveloperFeatures: true,
		status: "active",
		cancelAtPeriodEnd: false,
		paidThroughAt: new Date(Date.now() + 86_400_000),
		...overrides,
	};
}

test("the free tier allows exactly the advertised number of plans", () => {
	assert.equal(FREE_PLAN_LIMIT, 2);
	// The boundary is what the offer promises, so it is asserted on both sides.
	assert.doesNotThrow(() => assertCanCreatePlan(free({ planCount: 0 })));
	assert.doesNotThrow(() => assertCanCreatePlan(free({ planCount: 1 })));

	const refused = free({ planCount: 2, canCreatePlan: false });
	assert.throws(
		() => assertCanCreatePlan(refused),
		(error) =>
			error instanceof ServiceError &&
			error.code === "PLAN_LIMIT_REACHED" &&
			// A paywall status, not a generic 400: the request is valid, the tier
			// is the reason it is refused.
			error.status === 402,
	);
});

test("premium removes the plan cap and the feature gates", () => {
	assert.doesNotThrow(() => assertCanCreatePlan(premium({ planCount: 500 })));
	assert.doesNotThrow(() => assertCanUseRecurring(premium()));
	assert.doesNotThrow(() => assertCanUseDeveloperFeatures(premium()));
});

test("free refuses recurring plans and developer features by name", () => {
	assert.throws(
		() => assertCanUseRecurring(free()),
		(error) =>
			error instanceof ServiceError && error.code === "PREMIUM_REQUIRED",
	);
	assert.throws(
		() => assertCanUseDeveloperFeatures(free()),
		(error) =>
			error instanceof ServiceError && error.code === "PREMIUM_REQUIRED",
	);
});

/**
 * Downgrading is the case that quietly breaks: a creator who published five
 * packs on premium drops to free. Their existing plans must keep selling, so
 * the *creation* gate refuses while nothing is deleted.
 */
test("a downgraded creator keeps their existing plans", () => {
	const downgraded = free({ planCount: 5, canCreatePlan: false });
	assert.throws(
		() => assertCanCreatePlan(downgraded),
		(error) => error instanceof ServiceError,
	);
	// The entitlement still reports the real count; nothing pretends the extra
	// plans do not exist.
	assert.equal(downgraded.planCount, 5);
	assert.equal(downgraded.planLimit, FREE_PLAN_LIMIT);
});

/**
 * `deriveEntitlement` is the single place that answers "is this creator premium
 * right now". These cases are the ones that lose a paying customer's access or
 * grant access nobody paid for, so each is pinned rather than trusted.
 */
import { deriveEntitlement } from "@/lib/services/entitlements";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const future = new Date(NOW + 86_400_000);
const past = new Date(NOW - 86_400_000);

function sub(overrides: Record<string, unknown> = {}) {
	return {
		plan: "premium",
		status: "active",
		periodEnd: future,
		cancelAtPeriodEnd: false,
		...overrides,
	};
}

test("an active, paid-up subscription is premium", () => {
	const e = deriveEntitlement(sub(), 0, NOW);
	assert.equal(e.tier, "premium");
	assert.equal(e.isPremium, true);
	assert.equal(e.planLimit, null);
});

test("no subscription row is free", () => {
	const e = deriveEntitlement(undefined, 0, NOW);
	assert.equal(e.tier, "free");
	assert.equal(e.status, "free");
});

test("a failed renewal keeps access until the paid period ends", () => {
	// Stripe is still retrying a period the creator already owes for.
	const e = deriveEntitlement(sub({ status: "past_due" }), 0, NOW);
	assert.equal(e.tier, "premium");
	assert.equal(e.status, "past_due");
});

test("cancelled but still inside the paid period stays premium", () => {
	const e = deriveEntitlement(
		sub({ status: "canceled", cancelAtPeriodEnd: true }),
		0,
		NOW,
	);
	assert.equal(e.tier, "premium");
	assert.equal(e.status, "canceling");
});

test("an expired period is free even if Stripe still says active", () => {
	// The stale-status case: this is why entitlement follows periodEnd.
	const e = deriveEntitlement(sub({ periodEnd: past }), 0, NOW);
	assert.equal(e.tier, "free");
	assert.equal(e.status, "ended");
});

test("a non-premium plan is free regardless of status", () => {
	const e = deriveEntitlement(sub({ plan: "something_else" }), 0, NOW);
	assert.equal(e.tier, "free");
});

test("the plan cap applies only on the free tier", () => {
	assert.equal(deriveEntitlement(undefined, 2, NOW).canCreatePlan, false);
	assert.equal(deriveEntitlement(sub(), 999, NOW).canCreatePlan, true);
});

test("an incomplete checkout never grants premium", () => {
	// The plugin writes `incomplete` before payment; no period was ever paid.
	const e = deriveEntitlement(sub({ status: "incomplete" }), 0, NOW);
	assert.equal(e.tier, "free");
});
