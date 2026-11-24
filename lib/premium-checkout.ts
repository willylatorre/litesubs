import type Stripe from "stripe";

/**
 * Checkout parameters for liteSubs' own Premium subscription.
 *
 * Kept as a pure function, separate from `lib/auth.ts`, for two reasons: the
 * plugin's `getCheckoutSessionParams` hook must return synchronously and needs
 * no database or Stripe client to answer, and the rules below are the kind that
 * should be asserted by a test rather than re-derived by reading a plugin.
 *
 * ## Why tax lives here and nowhere else
 *
 * Premium is collected on the **platform** account, so the sales-tax obligation
 * is liteSubs'. A creator's own sales run as direct charges on their account,
 * where the tax obligation is theirs — configuring that for them would be
 * deciding how someone else's business collects tax. See
 * `docs/PLATFORM-BILLING.md`.
 *
 * ## Why `customer_update` is absent
 *
 * Stripe rejects `customer_update` when the session carries no Customer, and a
 * creator's first upgrade has only an email address. The plugin already supplies
 * `{ address: "auto" }` in exactly the case where a Customer exists, which is
 * also the only case where tax needs an address to calculate from. Passing it
 * here would break every first-time upgrade.
 */
export function premiumCheckoutParams(): Stripe.Checkout.SessionCreateParams {
	return {
		automatic_tax: { enabled: true },
		// A business buyer can enter a VAT id instead of paying tax it can
		// reclaim; without this, EU B2B customers are overcharged at checkout.
		tax_id_collection: { enabled: true },
		// "auto" asks for a billing address only when tax needs one, so a
		// consumer in a no-tax jurisdiction is not forced through an address form.
		billing_address_collection: "auto",
	};
}
