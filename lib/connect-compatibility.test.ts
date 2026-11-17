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

	it("accepts a Standard OAuth account even though Stripe omits the sub-fields", () => {
		// A real Standard account reports exactly `{type: "account"}` and nothing
		// else. The fee/loss/dashboard fields are only present on platform-created
		// accounts, so requiring them here would block every OAuth connection.
		const result = checkCompatibility({
			controller: { type: "account" },
		});
		assert.equal(result.compatible, true);
		assert.deepEqual(result.issues, []);
	});

	it("accepts a platform-created account with the agreed responsibilities", () => {
		// Every account a platform creates reports controller.type = "application";
		// it is read-only and records who created the account, not who owns the
		// responsibilities. Gating on it made the new-account flow produce accounts
		// that could never sell.
		const result = checkCompatibility(configured({ type: "application" }));
		assert.equal(result.compatible, true);
		assert.deepEqual(result.issues, []);
	});

	it("rejects an account without full Dashboard access", () => {
		// Only platform-controlled accounts expose these sub-fields, so the
		// rejection cases are expressed on that shape.
		const result = checkCompatibility(
			configured({ type: "application", dashboard: "express" }),
		);
		assert.equal(result.compatible, false);
		assert.ok(result.issues.includes("no_full_dashboard"));
	});

	it("rejects an account where the platform would pay Stripe fees", () => {
		const result = checkCompatibility(
			configured({ type: "application", fees: "application" }),
		);
		assert.equal(result.compatible, false);
		assert.ok(result.issues.includes("platform_pays_fees"));
	});

	it("rejects an account where the platform is liable for negative balances", () => {
		const result = checkCompatibility(
			configured({ type: "application", losses: "application" }),
		);
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
			"no_full_dashboard",
			"platform_pays_fees",
		]);
	});
});
