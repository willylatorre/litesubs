export const CURRENCIES = ["usd", "eur"] as const;

/**
 * How a plan charges for its credits. One-time plans sell a pack; recurring
 * plans sell a monthly allowance. Offering yearly terms is deferred.
 */
export const BILLING_MODES = ["one_time", "recurring"] as const;
export const BILLING_INTERVALS = ["month"] as const;

/** A plan's commercial terms are either the creator's working copy or frozen. */
export const PLAN_VERSION_STATUSES = [
	"draft",
	"published",
	"superseded",
] as const;

export const INVITE_STATUSES = ["pending", "accepted", "rejected"] as const;
export const TRANSACTION_TYPES = [
	"purchase",
	"manual_adjustment",
	"usage",
	"refund",
	/** A grant reached its expiry boundary and stops being spendable. */
	"expiry",
] as const;

export const TRANSACTION_STATUSES = [
	"ongoing",
	"completed",
	"declined",
] as const;

/**
 * liteSubs takes no share of a sale.
 *
 * The old 1% application fee was replaced by a flat creator subscription
 * (`docs/REFOCUS.md`), so nothing in the charge path attaches a fee. This is
 * kept as an explicit zero rather than deleted so any leftover arithmetic reads
 * as "no commission" instead of a missing constant.
 */
export const PLATFORM_FEE_PERCENT = 0;
