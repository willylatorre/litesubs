import assert from "node:assert/strict";
import { test } from "node:test";
import { isSubscriptionOverdue } from "@/lib/subscription-state";

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
