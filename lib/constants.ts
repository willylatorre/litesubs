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
