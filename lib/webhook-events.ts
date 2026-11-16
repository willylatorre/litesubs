/**
 * The outgoing-webhook contract, safe to import from a client component.
 *
 * Kept apart from `lib/services/webhooks.ts` deliberately: that module owns the
 * database and the signing secret, and must never be bundled into a browser
 * client. These are the names a receiver and the dashboard both need to agree
 * on, so they are plain data with no Node or database imports.
 */

/** Events a creator can subscribe an endpoint to. */
export const WEBHOOK_EVENT_TYPES = [
	"purchase.completed",
	"credits.changed",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
	"purchase.completed": "A one-time pack was purchased and credits granted",
	"credits.changed": "A customer's credit balance changed",
};

/** Bound on a single HTTP attempt. A slow receiver must not hold a request open. */
export const DELIVERY_TIMEOUT_MS = 5000;

export const SIGNATURE_HEADER = "X-Litesubs-Signature";
export const EVENT_ID_HEADER = "X-Litesubs-Event-Id";
export const EVENT_TYPE_HEADER = "X-Litesubs-Event-Type";
export const TIMESTAMP_HEADER = "X-Litesubs-Timestamp";

/**
 * The event envelope. Kept deliberately small: identity, money, and the
 * resulting balance. No Stripe ids, tokens, emails, or names ever appear here.
 */
export type WebhookEvent = {
	/** Stable across retries; the receiver's dedupe key. */
	id: string;
	type: WebhookEventType;
	/** ISO-8601 instant the business event happened. */
	createdAt: string;
	data: {
		creatorId: string;
		customerId: string;
		planId: string;
		/** Present when the movement came from a specific ledger row. */
		transactionId: string | null;
		/** Credits added (positive) or removed (negative). */
		amount: number;
		/** Spendable balance after the movement. */
		balance: number;
		/** Minor units and currency only for a paid purchase; null otherwise. */
		amountMoney: number | null;
		currency: string | null;
	};
};
