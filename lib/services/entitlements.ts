import { count, desc, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	type creatorTierEnum,
	FREE_PLAN_LIMIT,
	plans,
	subscription,
} from "@/app/db/schema";
import { ServiceError } from "./principal";

type Tier = (typeof creatorTierEnum.enumValues)[number];

/**
 * What a creator is entitled to, decided in one place.
 *
 * Two gates exist and they are deliberately different in kind:
 *
 * - **A hard cap** (plan count) is a billing rule: exceeding it must be refused,
 *   because the free tier's whole value proposition is that it is small.
 * - **A feature switch** (recurring plans, machine credentials) is also refused
 *   rather than hidden, because a UI-only gate is not a gate.
 *
 * Downgrading never destroys anything. A creator who published five packs on
 * premium and drops to free keeps all five selling; only creating a sixth is
 * refused. Deleting a customer's live offer to enforce a pricing change would be
 * taking money out of their hands.
 *
 * The tier itself is **derived, never stored**: it is a function of the platform
 * subscription row (`litesub_subscription`) that `@better-auth/stripe` keeps in
 * sync with Stripe. Storing a second copy would let entitlement drift from what
 * was actually billed.
 */
export type Entitlement = {
	tier: Tier;
	isPremium: boolean;
	/** `null` means unlimited. */
	planLimit: number | null;
	/** Plans the creator owns right now, drafts included. */
	planCount: number;
	canCreatePlan: boolean;
	canUseRecurring: boolean;
	canUseDeveloperFeatures: boolean;
	status: EntitlementStatus;
	cancelAtPeriodEnd: boolean;
	paidThroughAt: Date | null;
};

export type EntitlementStatus =
	| "free"
	| "active"
	| "past_due"
	| "canceling"
	| "ended";

/** Plan name the plugin is configured with. */
export const PREMIUM_PLAN = "premium";

export type StoredSubscription = {
	plan: string;
	status: string;
	periodEnd: Date | null;
	cancelAtPeriodEnd: boolean | null;
};

/**
 * Premium access follows the paid-through instant, not Stripe's status string.
 *
 * A failed renewal must not revoke access the creator already paid for, and a
 * `canceled` subscription whose period has not ended is still paid up. This is
 * the same rule customer subscriptions use, so the two cannot disagree about
 * what "paid" means.
 */
/**
 * Statuses that can never imply a paid period. Everything else is judged by
 * `periodEnd` alone.
 *
 * This is a **blacklist on purpose.** Whitelisting `active`/`past_due` would
 * cancel a creator the moment Stripe reports a status we did not think of (a new
 * status, a retry state, a `canceled` row whose period has not passed yet). The
 * rule the product promises is "you keep what you paid for", and that is a fact
 * about the period, not about Stripe's vocabulary.
 */
const NEVER_PAID = new Set(["incomplete", "incomplete_expired"]);

function isPremiumNow(
	row: StoredSubscription | undefined,
	now: number,
): boolean {
	if (!row) return false;
	if (row.plan !== PREMIUM_PLAN) return false;
	if (NEVER_PAID.has(row.status)) return false;
	return row.periodEnd === null || row.periodEnd.getTime() > now;
}

function statusFor(
	row: StoredSubscription | undefined,
	premium: boolean,
): EntitlementStatus {
	if (!premium) return row ? "ended" : "free";
	if (row?.cancelAtPeriodEnd) return "canceling";
	if (row?.status === "past_due") return "past_due";
	return "active";
}

/**
 * The whole tier decision, with no I/O.
 *
 * Kept pure so the one rule a reviewer cannot eyeball — "is this creator premium
 * right now" — is testable without a database or a clock. `now` is a parameter
 * rather than `Date.now()` for the same reason.
 */
export function deriveEntitlement(
	row: StoredSubscription | undefined,
	planCount: number,
	now: number,
): Entitlement {
	const premium = isPremiumNow(row, now);
	const limit = premium ? null : FREE_PLAN_LIMIT;

	return {
		tier: premium ? "premium" : "free",
		isPremium: premium,
		planLimit: limit,
		planCount,
		canCreatePlan: limit === null || planCount < limit,
		canUseRecurring: premium,
		canUseDeveloperFeatures: premium,
		status: statusFor(row, premium),
		cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
		paidThroughAt: row?.periodEnd ?? null,
	};
}

export async function getEntitlement(creatorId: string): Promise<Entitlement> {
	const [row, [{ value: planCount }]] = await Promise.all([
		// `referenceId` is the plugin's name for the creator; it defaults to the
		// session user id, which is also our `user.id`.
		db.query.subscription.findFirst({
			where: eq(subscription.referenceId, creatorId),
			orderBy: [desc(subscription.periodEnd)],
		}),
		db
			.select({ value: count() })
			.from(plans)
			.where(eq(plans.creatorId, creatorId)),
	]);

	return deriveEntitlement(row, planCount, Date.now());
}

/** Refuse a plan creation the tier does not allow. */
export function assertCanCreatePlan(entitlement: Entitlement) {
	if (entitlement.canCreatePlan) return;
	throw new ServiceError(
		"PLAN_LIMIT_REACHED",
		`The free tier includes ${FREE_PLAN_LIMIT} plans. Upgrade to Premium for unlimited plans.`,
		402,
		{ tier: entitlement.tier, planLimit: entitlement.planLimit },
	);
}

/** Refuse a recurring plan on a tier that does not include it. */
export function assertCanUseRecurring(entitlement: Entitlement) {
	if (entitlement.canUseRecurring) return;
	throw new ServiceError(
		"PREMIUM_REQUIRED",
		"Monthly plans are a Premium feature. Upgrade to publish recurring plans.",
		402,
		{ feature: "recurring" },
	);
}

/** Refuse API keys, webhooks, and MCP registration on a free tier. */
export function assertCanUseDeveloperFeatures(entitlement: Entitlement) {
	if (entitlement.canUseDeveloperFeatures) return;
	throw new ServiceError(
		"PREMIUM_REQUIRED",
		"API keys and webhooks are a Premium feature. Upgrade to connect your own app.",
		402,
		{ feature: "developer" },
	);
}
