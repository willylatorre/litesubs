import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { premiumCheckoutParams } from "@/lib/premium-checkout";

/**
 * Tax on the Premium subscription.
 *
 * The failure this guards is quiet: with `automatic_tax` absent, checkout
 * succeeds, the invoice looks ordinary, and no tax is ever computed. With it
 * present but no registration, Stripe returns 0.00 with no error. Neither shows
 * up as an error anywhere, so the shape of the request is the only thing a test
 * can pin.
 */
test("Premium checkout asks Stripe to calculate tax", () => {
	const params = premiumCheckoutParams();
	assert.deepEqual(params.automatic_tax, { enabled: true });
});

test("business buyers can enter a VAT id instead of paying reclaimable tax", () => {
	const params = premiumCheckoutParams();
	assert.deepEqual(params.tax_id_collection, { enabled: true });
});

test("an address is collected only when tax needs one", () => {
	// Forcing an address form on a consumer in a no-tax jurisdiction is avoidable
	// friction; "auto" asks exactly when Stripe needs it to calculate.
	assert.equal(premiumCheckoutParams().billing_address_collection, "auto");
});

/**
 * `customer_update` must stay out of this module.
 *
 * Stripe rejects the whole session when `customer_update` is sent without a
 * Customer, and a creator's first upgrade passes only `customer_email`. The
 * plugin supplies `{address: "auto"}` in the case where a Customer exists, so
 * adding it here to "help" tax would break every first-time upgrade — the one
 * checkout path that has no successful fallback.
 */
test("customer_update is left to the plugin, which knows whether a Customer exists", () => {
	const params = premiumCheckoutParams() as Record<string, unknown>;
	assert.equal(
		params.customer_update,
		undefined,
		"customer_update without a Customer makes Stripe reject the session",
	);
});

test("the hook in lib/auth.ts is wired to these params", async () => {
	// The module could be correct and unused, which is the same as absent.
	const source = await readFile("lib/auth.ts", "utf8");
	assert.match(
		source,
		/getCheckoutSessionParams:\s*\(\)\s*=>\s*\(\{\s*params:\s*premiumCheckoutParams\(\)\s*\}\)/,
	);
});
