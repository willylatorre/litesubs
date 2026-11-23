"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { authenticatedAction } from "@/lib/safe-action";
import { getEntitlement, PREMIUM_PLAN } from "@/lib/services/entitlements";
import {
	assertPremiumBillingConfigured,
	getPlatformSubscription,
	isPremiumBillingConfigured,
} from "@/lib/services/premium";
import { ServiceError } from "@/lib/services/principal";

/**
 * Creator-facing Premium billing.
 *
 * The money rules live in `@better-auth/stripe`; these actions only bind the
 * session and hand back a Stripe-hosted URL, because the plugin's endpoints need
 * the request headers to resolve the caller.
 */

export async function getBillingState() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: {
			entitlement: await getEntitlement(session.user.id),
			subscription: await getPlatformSubscription(session.user.id),
			configured: isPremiumBillingConfigured(),
		},
	}));
}

/** Redirect to Premium checkout. Redirect happens outside the action's catch. */
export async function startPremiumCheckoutAction() {
	const result = await authenticatedAction<{ url: string }>(async () => {
		try {
			assertPremiumBillingConfigured();
			const requestHeaders = await headers();
			const { url } = await auth.api.upgradeSubscription({
				body: {
					plan: PREMIUM_PLAN,
					successUrl: appUrl("/dashboard/billing?upgraded=true"),
					cancelUrl: appUrl("/dashboard/billing?canceled=true"),
					// The plugin sends the browser here after checkout so it can sync
					// the subscription immediately instead of waiting for the webhook.
					returnUrl: appUrl("/dashboard/billing"),
					disableRedirect: true,
				},
				headers: requestHeaders,
			});
			if (!url)
				throw new ServiceError(
					"CHECKOUT_UNAVAILABLE",
					"Stripe did not return a checkout URL",
					502,
				);
			return { success: true, data: { url } };
		} catch (error) {
			return {
				error:
					error instanceof ServiceError
						? error.message
						: "Could not start checkout",
				code: error instanceof ServiceError ? error.code : undefined,
			};
		}
	});

	if (result.data?.url) redirect(result.data.url);
	return result;
}

/** Redirect to the Stripe portal so a creator can update or cancel Premium. */
export async function managePremiumBillingAction() {
	const result = await authenticatedAction<{ url: string }>(async () => {
		try {
			assertPremiumBillingConfigured();
			const requestHeaders = await headers();
			const { url } = await auth.api.createBillingPortal({
				body: {
					returnUrl: appUrl("/dashboard/billing"),
					// Only surface Stripe's own cancel/update flows; the plugin owns them.
					disableRedirect: true,
				},
				headers: requestHeaders,
			});
			if (!url)
				throw new ServiceError(
					"CHECKOUT_UNAVAILABLE",
					"Stripe did not return a portal URL",
					502,
				);
			return { success: true, data: { url } };
		} catch (error) {
			return {
				error:
					error instanceof ServiceError
						? error.message
						: "Could not open billing",
				code: error instanceof ServiceError ? error.code : undefined,
			};
		}
	});

	if (result.data?.url) redirect(result.data.url);
	return result;
}
