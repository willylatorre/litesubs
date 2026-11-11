import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isSampleCustomerId,
	isSampleInviteId,
	isSamplePlanId,
	sampleIds,
} from "@/lib/sample-data";

test("sample IDs are scoped to one creator and never collide with each other", () => {
	const a = sampleIds("creator-a");
	const b = sampleIds("creator-b");
	const values = Object.values(a);

	assert.equal(new Set(values).size, values.length);
	assert.notEqual(a.plan, b.plan);
	assert.notEqual(a.customer, b.customer);
	assert.match(a.customerEmail, /^[^@\s]+@example\.com$/);
	assert.ok(a.customerEmail.includes("creatora"));
});

test("sample rows are recognised by their prefix, real IDs are not", () => {
	const ids = sampleIds("creator-a");

	assert.equal(isSamplePlanId(ids.plan), true);
	assert.equal(isSampleCustomerId(ids.customer), true);
	assert.equal(isSampleInviteId(ids.invite), true);

	// cuid/uuid IDs from every other write path must never be mistaken for sample.
	assert.equal(isSamplePlanId(crypto.randomUUID()), false);
	assert.equal(isSampleCustomerId("3f2c1a9e"), false);
	assert.equal(isSampleInviteId(null), false);
	assert.equal(isSampleInviteId(undefined), false);
});
