import type { AccountStatus } from "@/app/db/stripe-connect-schema";

/**
 * What a creator's account may currently do, derived only from Stripe's
 * reported capabilities and requirements.
 *
 * `canSell` is deliberately narrower than "connected": a new sale needs the
 * merchant capability (`charges_enabled`) *and* an account that Stripe is not
 * blocking. A local row, a submitted form, or a Stripe account ID is never
 * enough on its own.
 */
export type AccountReadiness = {
	status: AccountStatus;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
	canSell: boolean;
	/** Human-actionable requirement fields that Stripe still needs. */
	requirementsDue: string[];
	disabledReason: string | null;
	/** An account Stripe cannot accept payments for right now. */
	needsAttention: boolean;
};

type AccountLike = {
	charges_enabled: boolean;
	payouts_enabled: boolean;
	details_submitted: boolean;
	/**
	 * Per-capability state. `charges_enabled` is an aggregate flag; a direct
	 * charge specifically needs `card_payments` active (Stripe only activates it
	 * when `transfers` was requested too).
	 */
	capabilities?: { card_payments?: string | null } | null;
	requirements?: {
		currently_due?: string[] | null;
		disabled_reason?: string | null;
	} | null;
};

export function deriveReadiness(account: AccountLike): AccountReadiness {
	const requirements = account.requirements ?? undefined;
	const requirementsDue = requirements?.currently_due ?? [];
	const disabledReason = requirements?.disabled_reason ?? null;
	// A direct charge needs the card_payments capability specifically. Prefer it
	// when Stripe reports capabilities; fall back to the aggregate flag only for
	// snapshots that omit the capability map.
	const cardPaymentsActive =
		account.capabilities?.card_payments === undefined
			? Boolean(account.charges_enabled)
			: account.capabilities.card_payments === "active";
	const chargesEnabled = Boolean(account.charges_enabled) && cardPaymentsActive;
	const payoutsEnabled = Boolean(account.payouts_enabled);
	const detailsSubmitted = Boolean(account.details_submitted);

	// Stripe's disable reason is the strongest signal: a `rejected.*` or
	// `under_review` reason blocks sales even when a stale snapshot says enabled.
	const blockedByStripe = Boolean(disabledReason);

	const canSell = chargesEnabled && !blockedByStripe;

	let status: AccountStatus;
	if (!canSell && (disabledReason || !detailsSubmitted)) {
		// Not submitted yet is normal onboarding; a disable reason means the
		// account was restricted after review.
		status = !detailsSubmitted && !disabledReason ? "pending" : "restricted";
	} else if (canSell && payoutsEnabled) {
		status = "active";
	} else if (canSell) {
		// Can take payments but not pay out yet. Selling is allowed; this is a
		// warning state rather than a hard block.
		status = "restricted";
	} else {
		status = "disabled";
	}

	return {
		status,
		chargesEnabled,
		payoutsEnabled,
		detailsSubmitted,
		canSell,
		requirementsDue,
		disabledReason,
		needsAttention: !canSell,
	};
}
