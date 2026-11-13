export type SubscriptionStatus =
	| "pending"
	| "incomplete"
	| "active"
	| "past_due"
	| "canceled";

export type SubscriptionCancellationCause = "customer" | "creator_disconnect";

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

/**
 * What a customer is actually entitled to, in words both sides agree on.
 *
 * A scheduled end caused by the creator disconnecting is not a customer choice,
 * and a renewal date that will not be honoured must not be shown as if it will.
 */
export type SubscriptionDisplayState =
	| "processing"
	| "overdue"
	| "ended"
	| "creator_disconnected"
	| "scheduled_to_end"
	| "active";

export function subscriptionDisplayState(input: {
	status: SubscriptionStatus;
	paidThroughAt: Date | null;
	cancelAtPeriodEnd: boolean;
	cancellationCause: SubscriptionCancellationCause | null;
	overdue: boolean;
}): SubscriptionDisplayState {
	if (input.status === "canceled") return "ended";
	if (input.overdue) return "overdue";
	if (
		input.cancelAtPeriodEnd &&
		input.cancellationCause === "creator_disconnect"
	)
		return "creator_disconnected";
	if (input.cancelAtPeriodEnd) return "scheduled_to_end";
	if (input.status === "active") return "active";
	return "processing";
}

/**
 * Honest wording for each state. `creator_disconnected` exists so a customer is
 * never told "renews monthly" by a creator who can no longer fulfil.
 */
export const subscriptionStateCopy: Record<SubscriptionDisplayState, string> = {
	processing: "Payment processing",
	overdue: "Payment overdue",
	ended: "Subscription ended",
	creator_disconnected: "Ending — creator disconnected billing",
	scheduled_to_end: "Scheduled to end",
	active: "Active",
};

/**
 * One sentence for a customer's own subscription row.
 *
 * A renewal that will not be honoured must not read like a normal renewal, and a
 * creator-driven stop must not read like the customer's decision.
 */
export function customerSubscriptionSummary(input: {
	status: SubscriptionStatus;
	paidThroughAt: Date | null;
	cancelAt: Date | null;
	cancelAtPeriodEnd: boolean;
	cancellationCause: SubscriptionCancellationCause | null;
	overdue: boolean;
}) {
	const through = (date: Date | null | undefined) =>
		date ? ` ${date.toLocaleDateString()}` : " its paid period";
	switch (
		subscriptionDisplayState({
			status: input.status,
			paidThroughAt: input.paidThroughAt,
			cancelAtPeriodEnd: input.cancelAtPeriodEnd,
			cancellationCause: input.cancellationCause,
			overdue: input.overdue,
		})
	) {
		case "ended":
			return `Subscription ended${input.paidThroughAt ? ` · paid through ${input.paidThroughAt.toLocaleDateString()}` : ""}`;
		case "overdue":
			return `Payment overdue${input.paidThroughAt ? ` · paid through ${input.paidThroughAt.toLocaleDateString()}` : ""}`;
		case "creator_disconnected":
			return `The creator disconnected Stripe billing. Your credits stay usable through${through(input.cancelAt ?? input.paidThroughAt)}, and there will be no further renewal.`;
		case "scheduled_to_end":
			return `Scheduled to end${input.cancelAt ? ` on ${input.cancelAt.toLocaleDateString()}` : ""}; credits stay usable through${through(input.paidThroughAt)}.`;
		case "active":
			return `Subscription active${input.paidThroughAt ? ` through ${input.paidThroughAt.toLocaleDateString()}` : ""}`;
		default:
			return "First payment is processing";
	}
}
