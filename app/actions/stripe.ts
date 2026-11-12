"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/app/db";
import { plans } from "@/app/db/schema";
import { getAppUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";
import { getPaymentReadiness } from "@/lib/services/connect";
import { resolvePublishedPlan } from "@/lib/services/plans";
import {
	createDirectCheckoutSession,
	isValidApplicationFee,
} from "@/lib/stripe-direct-charges";

/**
 * Start a direct-charge Checkout for a published plan on the creator's own
 * Stripe account. The platform never charges on its own account here.
 */
export async function createCheckoutSession(planId: string) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return { error: "Unauthorized" };

	const plan = await db.query.plans.findFirst({
		where: eq(plans.id, planId),
		with: { versions: true },
	});
	if (!plan) return { error: "Plan not found" };
	const published = plan.versions.find((v) => v.status === "published");
	if (!published)
		return { error: "This plan is not available for purchase yet" };

	const readiness = await getPaymentReadiness(plan.creatorId);
	if (!readiness.canSell || !readiness.stripeAccountId)
		return { error: "This creator cannot accept payments yet" };

	const fee = Math.round(published.price * PLATFORM_FEE_PERCENT);
	if (!isValidApplicationFee(fee, published.price))
		return { error: "This plan's fee cannot be collected on Stripe" };

	let checkoutSession: Awaited<ReturnType<typeof createDirectCheckoutSession>>;
	try {
		checkoutSession = await createDirectCheckoutSession({
			stripeAccountId: readiness.stripeAccountId,
			lineItem: {
				name: plan.name,
				description: plan.description,
				unitAmount: published.price,
				currency: published.currency,
			},
			applicationFeeAmount: fee,
			customerEmail: session.user.email,
			successUrl: `${getAppUrl()}/dashboard?success=true&planId=${plan.id}`,
			cancelUrl: `${getAppUrl()}/dashboard?canceled=true`,
			metadata: {
				userId: session.user.id,
				planId: plan.id,
				planVersionId: published.id,
				creatorId: plan.creatorId,
				credits: String(published.credits),
				type: "credit_purchase",
			},
		});
	} catch {
		return { error: "Stripe is not configured" };
	}

	if (checkoutSession.url) redirect(checkoutSession.url);
	return { error: "No checkout URL was returned" };
}

/**
 * Creator-generated single-use checkout for one customer and one plan. This
 * replaces reusable Payment Links that carried another user's identity.
 */
export async function createCustomerCheckout(
	planId: string,
	customerEmail: string,
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return { error: "Unauthorized" };

	const plan = await db.query.plans.findFirst({
		where: eq(plans.id, planId),
	});
	if (!plan || plan.creatorId !== session.user.id)
		return { error: "Plan not found" };

	const readiness = await getPaymentReadiness(plan.creatorId);
	if (!readiness.canSell || !readiness.stripeAccountId)
		return { error: "Connect Stripe payments before requesting payment" };

	let resolved: Awaited<ReturnType<typeof resolvePublishedPlan>>;
	try {
		resolved = await resolvePublishedPlan(session.user.id, planId);
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Plan unavailable",
		};
	}
	const fee = Math.round(resolved.terms.price * PLATFORM_FEE_PERCENT);
	if (!isValidApplicationFee(fee, resolved.terms.price))
		return {
			success: false,
			error: "This plan's fee cannot be collected on Stripe",
		};

	try {
		const checkout = await createDirectCheckoutSession({
			stripeAccountId: readiness.stripeAccountId,
			lineItem: {
				name: plan.name,
				description: plan.description,
				unitAmount: resolved.terms.price,
				currency: resolved.terms.currency,
			},
			applicationFeeAmount: fee,
			customerEmail,
			successUrl: `${getAppUrl()}/dashboard?success=true&planId=${plan.id}`,
			cancelUrl: `${getAppUrl()}/dashboard?canceled=true`,
			metadata: {
				planId: plan.id,
				planVersionId: resolved.terms.id,
				creatorId: plan.creatorId,
				credits: String(resolved.terms.credits),
				type: "credit_purchase",
			},
		});
		return { success: true, url: checkout.url };
	} catch {
		return { success: false, error: "Stripe is not configured" };
	}
}
