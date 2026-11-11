import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { errorResponse } from "@/lib/api-response";

test("unexpected provider errors do not expose credentials in responses or logs", async () => {
	const secret = "sk_test_fixture_not_a_real_key";
	const logged: unknown[][] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		logged.push(args);
	};
	try {
		const response = errorResponse(
			new Error(`Expired API Key provided: ${secret}`),
		);
		assert.equal(response.status, 500);
		assert.deepEqual(await response.json(), {
			error: "Request failed",
			code: "INTERNAL_ERROR",
		});
		assert.ok(logged.length > 0);
		assert.ok(!inspect(logged).includes(secret));
	} finally {
		console.error = original;
	}
});
