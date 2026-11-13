import assert from "node:assert/strict";
import { test } from "node:test";
import {
	customerSubscriptionSummary,
	isSubscriptionOverdue,
	subscriptionDisplayState,
} from "@/lib/subscription-state";

test("paid-through remains the entitlement signal when Stripe status is stale", () => {
	const now = new Date("2026-11-12T12:00:00.000Z");
	assert.equal(
		isSubscriptionOverdue("active", new Date("2026-11-12T11:59:59.000Z"), now),
		true,
	);
	assert.equal(
		isSubscriptionOverdue("active", new Date("2026-11-12T12:00:01.000Z"), now),
		false,
	);
	assert.equal(
		isSubscriptionOverdue(
			"past_due",
			new Date("2026-11-13T12:00:00.000Z"),
			now,
		),
		true,
	);
});

/**
 * A creator disconnect uses the same Stripe cancellation as a customer's own
 * choice. The read model must keep them visibly distinct, or a customer is told
 * they cancelled something they did not, and told a renewal will happen when it
 * will not.
 */
test("a creator disconnect is never shown as a customer choice or a renewal", () => {
	const paidThrough = new Date("2026-12-01T00:00:00.000Z");
	const base = {
		status: "active" as const,
		paidThroughAt: paidThrough,
		cancelAtPeriodEnd: true,
		overdue: false,
	};
	assert.equal(
		subscriptionDisplayState({ ...base, cancellationCause: "customer" }),
		"scheduled_to_end",
	);
	assert.equal(
		subscriptionDisplayState({
			...base,
			cancellationCause: "creator_disconnect",
		}),
		"creator_disconnected",
	);
	// A clean disconnect cannot read as "scheduled to end" by the customer.
	assert.notEqual(
		customerSubscriptionSummary({
			...base,
			cancelAt: paidThrough,
			cancellationCause: "creator_disconnect",
		}),
		customerSubscriptionSummary({
			...base,
			cancelAt: paidThrough,
			cancellationCause: "customer",
		}),
	);
	assert.match(
		customerSubscriptionSummary({
			...base,
			cancelAt: paidThrough,
			cancellationCause: "creator_disconnect",
		}),
		/no further renewal/i,
	);
	// An ordinary renewal is unaffected by the new states.
	assert.equal(
		subscriptionDisplayState({
			...base,
			cancelAtPeriodEnd: false,
			cancellationCause: null,
		}),
		"active",
	);
});
