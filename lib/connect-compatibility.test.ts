import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCompatibility } from "@/lib/services/connect";

/**
 * An existing Stripe account can only be used if its *responsibilities* match
 * what Litesubs agreed to. These cases pin that the check refuses rather than
 * silently changing an account or quietly charging it the wrong way.
 */
const configured = (
	overrides: {
		type?: string;
		dashboard?: string;
		fees?: string;
		losses?: string;
	} = {},
) => ({
	controller: {
		type: overrides.type ?? "account",
		stripe_dashboard: { type: overrides.dashboard ?? "full" },
		fees: { payer: overrides.fees ?? "account" },
		losses: { payments: overrides.losses ?? "stripe" },
	},
});

describe("checkCompatibility", () => {
	it("accepts a self-controlled account with full Dashboard, own fees, and Stripe losses", () => {
		const result = checkCompatibility(configured());
		assert.equal(result.compatible, true);
		assert.deepEqual(result.issues, []);
		assert.equal(result.configuration.controllerType, "account");
	});

	it("rejects a platform-controlled account", () => {
		const result = checkCompatibility(configured({ type: "application" }));
		assert.equal(result.compatible, false);
		assert.ok(result.issues.includes("platform_controlled"));
	});

	it("rejects an account without full Dashboard access", () => {
		const result = checkCompatibility(configured({ dashboard: "express" }));
		assert.equal(result.compatible, false);
		assert.ok(result.issues.includes("no_full_dashboard"));
	});

	it("rejects an account where the platform would pay Stripe fees", () => {
		const result = checkCompatibility(configured({ fees: "application" }));
		assert.equal(result.compatible, false);
		assert.ok(result.issues.includes("platform_pays_fees"));
	});

	it("rejects an account where the platform is liable for negative balances", () => {
		const result = checkCompatibility(configured({ losses: "application" }));
		assert.equal(result.compatible, false);
		assert.ok(result.issues.includes("platform_liable_for_losses"));
	});

	it("reports unknown configuration instead of guessing it is fine", () => {
		const result = checkCompatibility({ controller: undefined });
		assert.equal(result.compatible, false);
		assert.ok(result.issues.includes("unknown_configuration"));
	});

	it("lists every issue once when several responsibilities are wrong", () => {
		const result = checkCompatibility(
			configured({
				type: "application",
				dashboard: "none",
				fees: "application",
			}),
		);
		assert.deepEqual(result.issues, [
			"platform_controlled",
			"no_full_dashboard",
			"platform_pays_fees",
		]);
	});
});
