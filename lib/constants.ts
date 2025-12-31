export const CURRENCIES = ["usd", "eur"] as const;
export const PRODUCT_TYPES = ["one_time", "recurring"] as const;
export const INVITE_STATUSES = ["pending", "accepted", "rejected"] as const;
export const TRANSACTION_TYPES = [
	"purchase",
	"manual_adjustment",
	"usage",
	"refund",
] as const;

export const TRANSACTION_STATUSES = ["ongoing", "completed", "declined"] as const;

export const PLATFORM_FEE_PERCENT = 0.1; // 10%
export const MIN_PAYOUT_AMOUNT = 50.0;
