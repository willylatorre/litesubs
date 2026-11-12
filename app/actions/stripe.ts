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
import { getStripe } from "@/lib/stripe";

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
	let checkoutSession: Awaited<
		ReturnType<ReturnType<typeof getStripe>["checkout"]["sessions"]["create"]>
	>;
	try {
		checkoutSession = await getStripe().checkout.sessions.create({
			mode: "payment",
			line_items: [
				{
					price_data: {
						currency: published.currency,
						product_data: {
							name: plan.name,
							description: plan.description || undefined,
						},
						unit_amount: published.price,
					},
					quantity: 1,
				},
			],
			customer_email: session.user.email,
			success_url: `${getAppUrl()}/dashboard?success=true&planId=${plan.id}`,
			cancel_url: `${getAppUrl()}/dashboard?canceled=true`,
			metadata: {
				userId: session.user.id,
				planId: plan.id,
				planVersionId: published.id,
				creatorId: plan.creatorId,
				credits: String(published.credits),
				type: "credit_purchase",
			},
			payment_intent_data: {
				application_fee_amount: fee,
				transfer_data: { destination: readiness.stripeAccountId },
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

	try {
		const checkout = await getStripe().checkout.sessions.create({
			mode: "payment",
			line_items: [
				{
					price_data: {
						currency: resolved.terms.currency,
						product_data: {
							name: plan.name,
							description: plan.description || undefined,
						},
						unit_amount: resolved.terms.price,
					},
					quantity: 1,
				},
			],
			customer_email: customerEmail,
			success_url: `${getAppUrl()}/dashboard?success=true&planId=${plan.id}`,
			cancel_url: `${getAppUrl()}/dashboard?canceled=true`,
			metadata: {
				planId: plan.id,
				planVersionId: resolved.terms.id,
				creatorId: plan.creatorId,
				credits: String(resolved.terms.credits),
				type: "credit_purchase",
			},
			payment_intent_data: {
				application_fee_amount: fee,
				transfer_data: { destination: readiness.stripeAccountId },
			},
		});
		return { success: true, url: checkout.url };
	} catch {
		return { success: false, error: "Stripe is not configured" };
	}
}
