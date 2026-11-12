import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isValidApplicationFee } from "@/lib/stripe-direct-charges";

/**
 * Litesubs sells with **direct charges**: the session is created as the
 * connected account, and only an application fee is attached. Adding
 * `transfer_data` silently converts it into a destination charge, moving the
 * charge (and the fee/liability/statement) onto the platform.
 *
 * This guards the source because the difference is invisible at runtime until
 * real money lands on the wrong balance.
 */
test("checkout code never turns a direct charge into a destination charge", async () => {
	const files = [
		"lib/stripe-direct-charges.ts",
		"app/actions/stripe.ts",
		"lib/services/enroll.ts",
	];
	for (const file of files) {
		const source = await readFile(file, "utf8");
		// Ignore comments, which legitimately explain why this is absent.
		const code = source
			.split("\n")
			.filter((line) => !line.trim().startsWith("*"))
			.filter((line) => !line.trim().startsWith("//"))
			.join("\n");
		assert.doesNotMatch(
			code,
			/transfer_data/,
			`${file} must not use transfer_data (that makes it a destination charge)`,
		);
	}

	const direct = await readFile("lib/stripe-direct-charges.ts", "utf8");
	assert.match(direct, /stripeAccount:\s*input\.stripeAccountId/);
	assert.match(direct, /application_fee_amount/);
});

test("application fees must be positive and below the charge amount", () => {
	assert.equal(isValidApplicationFee(2, 100), true);
	assert.equal(isValidApplicationFee(0, 100), false);
	assert.equal(isValidApplicationFee(100, 100), false);
	assert.equal(isValidApplicationFee(-1, 100), false);
	assert.equal(isValidApplicationFee(1.5, 100), false);
});
