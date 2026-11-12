import type { Stripe } from "stripe";
import { appUrl } from "@/lib/app-url";
import { getStripe } from "@/lib/stripe";

const CONFIGURATION_KEY = "litesubs_customer_billing_v1";

function configurationParams(): Stripe.BillingPortal.ConfigurationCreateParams {
	return {
		name: "Litesubs customer billing",
		default_return_url: appUrl("/dashboard/account"),
		metadata: { litesubs_configuration: CONFIGURATION_KEY },
		features: {
			customer_update: { enabled: false, allowed_updates: [] },
			invoice_history: { enabled: true },
			payment_method_update: { enabled: true },
			subscription_cancel: { enabled: false },
			subscription_pause: { enabled: false },
			subscription_update: { enabled: false, default_allowed_updates: [] },
		},
	};
}

function supportsCustomerBilling(config: Stripe.BillingPortal.Configuration) {
	return (
		config.active &&
		config.features.payment_method_update.enabled &&
		config.features.invoice_history.enabled &&
		!config.features.customer_update.enabled &&
		!config.features.subscription_cancel.enabled &&
		!config.features.subscription_pause.enabled &&
		!config.features.subscription_update.enabled
	);
}

/** Create/reconcile a marked platform configuration; it is never account-scoped. */
export async function ensureCustomerBillingPortalConfiguration() {
	const stripe = getStripe();
	let startingAfter: string | undefined;
	let existing: Stripe.BillingPortal.Configuration | undefined;
	for (;;) {
		const page = await stripe.billingPortal.configurations.list({
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		existing = page.data.find(
			(config) => config.metadata?.litesubs_configuration === CONFIGURATION_KEY,
		);
		if (existing || !page.has_more) break;
		startingAfter = page.data.at(-1)?.id;
		if (!startingAfter) break;
	}

	if (existing) {
		if (supportsCustomerBilling(existing)) return existing;
		return stripe.billingPortal.configurations.update(existing.id, {
			...configurationParams(),
			active: true,
		});
	}
	return stripe.billingPortal.configurations.create(configurationParams(), {
		idempotencyKey: `litesubs:billing-portal-configuration:${CONFIGURATION_KEY}`,
	});
}

/** Portal sessions are short-lived and scoped to the connected account Customer. */
export async function createConnectedBillingPortalSession(input: {
	stripeAccountId: string;
	stripeCustomerId: string;
	configurationId: string;
	returnUrl: string;
}) {
	return getStripe().billingPortal.sessions.create(
		{
			customer: input.stripeCustomerId,
			configuration: input.configurationId,
			return_url: input.returnUrl,
		},
		{ stripeAccount: input.stripeAccountId },
	);
}
