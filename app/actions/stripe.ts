"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/app/db";
import { plans, user } from "@/app/db/schema";
import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { resolvePublishedPlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import {
	issueCheckoutToken,
	startPurchase,
	startSubscription,
} from "@/lib/services/purchase";

/**
 * Self-service purchase of a published plan. The shared purchase service owns
 * the fee, customer mapping, receipt, and fulfillment rules; this action only
 * adds the authenticated buyer and the redirect.
 */
export async function createCheckoutSession(planId: string) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return { error: "Unauthorized" };

	const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
	if (!plan) return { error: "Plan not found" };

	let result: Awaited<ReturnType<typeof startPurchase>>;
	try {
		const published = await resolvePublishedPlan(plan.creatorId, planId);
		const start =
			published.terms.billingMode === "recurring"
				? startSubscription
				: startPurchase;
		result = await start(sessionPrincipal(plan.creatorId), {
			planId,
			userId: session.user.id,
		});
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Checkout unavailable",
		};
	}

	if (result.url) redirect(result.url);
	return { error: "No checkout URL was returned" };
}

/**
 * Creator-generated purchase request for one customer and one published plan.
 *
 * The link carries only an opaque, single-use token. The old version embedded
 * the customer's identity, so anyone who saw the URL could buy against someone
 * else's account. The recipient signs in, and the token is consumed on first
 * use, so a forwarded link cannot be replayed.
 */
export async function createCustomerCheckout(
	planId: string,
	customerEmail: string,
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return { error: "Unauthorized" };

	const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
	if (!plan || plan.creatorId !== session.user.id)
		return { error: "Plan not found" };

	const customer = await db.query.user.findFirst({
		where: sql`lower(${user.email}) = ${customerEmail.trim().toLowerCase()}`,
		columns: { id: true, email: true },
	});
	if (!customer)
		return {
			success: false,
			error:
				"That customer needs a Litesubs account before you can request payment",
		};

	let resolved: Awaited<ReturnType<typeof resolvePublishedPlan>>;
	try {
		resolved = await resolvePublishedPlan(session.user.id, planId);
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : "Plan unavailable",
		};
	}

	const token = await issueCheckoutToken({
		creatorId: session.user.id,
		userId: customer.id,
		planId: plan.id,
	});
	return {
		success: true,
		url: appUrl(`/pay/${token}`),
		credits: resolved.terms.credits,
		message: "No email was sent. Forward this single-use link to the customer.",
	};
}
