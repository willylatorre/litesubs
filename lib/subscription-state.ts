export type SubscriptionStatus =
	| "pending"
	| "incomplete"
	| "active"
	| "past_due"
	| "canceled";

/**
 * Payment status can lag webhook delivery. A paid-through boundary is the
 * entitlement truth, so an active Stripe mirror with an expired paid period is
 * still overdue for customer/creator summaries.
 */
export function isSubscriptionOverdue(
	status: SubscriptionStatus,
	paidThroughAt: Date | null,
	now = new Date(),
) {
	return (
		status === "past_due" ||
		(status === "active" &&
			paidThroughAt !== null &&
			paidThroughAt.getTime() <= now.getTime())
	);
}
