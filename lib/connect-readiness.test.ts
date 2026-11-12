import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveReadiness } from "@/lib/connect-readiness";

/**
 * Readiness is the gate every sale checks. These cases pin the difference
 * between "an account row exists" and "Stripe says this account can be charged".
 */
const account = (
	overrides: Partial<Parameters<typeof deriveReadiness>[0]> = {},
) => ({
	charges_enabled: false,
	payouts_enabled: false,
	details_submitted: false,
	requirements: { currently_due: [] as string[], disabled_reason: null },
	...overrides,
});

describe("deriveReadiness", () => {
	it("does not permit sales before onboarding is submitted", () => {
		const readiness = deriveReadiness(account());
		assert.equal(readiness.canSell, false);
		assert.equal(readiness.status, "pending");
		assert.equal(readiness.needsAttention, true);
	});

	it("permits sales only when Stripe reports charges enabled", () => {
		const readiness = deriveReadiness(
			account({
				charges_enabled: true,
				payouts_enabled: true,
				details_submitted: true,
			}),
		);
		assert.equal(readiness.canSell, true);
		assert.equal(readiness.status, "active");
		assert.equal(readiness.needsAttention, false);
	});

	it("blocks sales when Stripe has disabled the account, even if a stale snapshot says enabled", () => {
		const readiness = deriveReadiness(
			account({
				charges_enabled: true,
				payouts_enabled: true,
				details_submitted: true,
				requirements: {
					currently_due: [],
					disabled_reason: "rejected.fraud",
				},
			}),
		);
		assert.equal(readiness.canSell, false);
		assert.equal(readiness.needsAttention, true);
		assert.equal(readiness.disabledReason, "rejected.fraud");
	});

	it("keeps selling allowed when only payouts are blocked", () => {
		const readiness = deriveReadiness(
			account({
				charges_enabled: true,
				payouts_enabled: false,
				details_submitted: true,
			}),
		);
		assert.equal(readiness.canSell, true);
		assert.equal(readiness.status, "restricted");
	});

	it("surfaces requirement fields so the creator can fix them", () => {
		const readiness = deriveReadiness(
			account({
				details_submitted: true,
				requirements: {
					currently_due: [
						"external_account",
						"individual.verification.document",
					],
					disabled_reason: null,
				},
			}),
		);
		assert.equal(readiness.canSell, false);
		assert.deepEqual(readiness.requirementsDue, [
			"external_account",
			"individual.verification.document",
		]);
	});
});
