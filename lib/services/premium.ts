import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import { subscription } from "@/app/db/schema";
import { ServiceError } from "./principal";

/**
 * Platform billing: the creator paying liteSubs.
 *
 * The transport lives in `@better-auth/stripe` (`/subscription/upgrade`,
 * `/billing-portal`, `/cancel`, `/restore`). This module only answers the two
 * questions the dashboard asks that the plugin does not:
 *
 * - is billing configured at all, so the UI can explain itself instead of
 *   offering a button that will fail; and
 * - what does the creator's subscription row look like, for display.
 *
 * It deliberately contains no Stripe calls and no state writing. Entitlement is
 * derived from `litesub_subscription`, which the plugin's webhook owns — a second
 * writer is exactly the drift `docs/PLATFORM-BILLING.md` exists to prevent.
 */

export const PREMIUM_PRICE_USD = 500;

/** Plan name must match the `plans` entry registered in `lib/auth.ts`. */
export { PREMIUM_PLAN } from "./entitlements";

export function isPremiumBillingConfigured(): boolean {
	return Boolean(
		process.env.STRIPE_PREMIUM_PRICE_ID?.trim() &&
			process.env.STRIPE_WEBHOOK_BILLING?.trim() &&
			process.env.STRIPE_SECRET_KEY,
	);
}

/** Billing is not configured; the UI should say so rather than 500. */
export function assertPremiumBillingConfigured() {
	if (isPremiumBillingConfigured()) return;
	throw new ServiceError(
		"PREMIUM_NOT_CONFIGURED",
		"Premium billing is not configured yet",
		503,
	);
}

export type PlatformSubscriptionView = {
	plan: string;
	status: string;
	periodEnd: Date | null;
	cancelAtPeriodEnd: boolean;
};

/** The creator's own platform subscription row, for display only. */
export async function getPlatformSubscription(
	creatorId: string,
): Promise<PlatformSubscriptionView | null> {
	const row = await db.query.subscription.findFirst({
		where: eq(subscription.referenceId, creatorId),
	});
	if (!row) return null;
	return {
		plan: row.plan,
		status: row.status,
		periodEnd: row.periodEnd,
		cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
	};
}
