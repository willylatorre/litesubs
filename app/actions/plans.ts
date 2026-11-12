"use server";

import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import {
	enrollments,
	plans,
	planVersions,
	subscriptions,
} from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { usableBalances } from "@/lib/services/credits";
import { createPlan, listPlans, updatePlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import { publishPlan, unpublishPlan } from "@/lib/services/publish";
import { isSubscriptionOverdue } from "@/lib/subscription-state";

export async function createPlanAction(
	_prevState: unknown,
	formData: FormData,
) {
	return authenticatedAction(async (session) => {
		const interval = formData.get("interval");
		await createPlan(sessionPrincipal(session.user.id), {
			name: formData.get("name"),
			description: formData.get("description") || undefined,
			terms: {
				billingMode: formData.get("billingMode") || "one_time",
				currency: formData.get("currency") || "usd",
				price: Number(formData.get("price")),
				credits: Number(formData.get("credits")),
				interval: interval === "month" ? "month" : null,
			},
		});
		revalidatePath("/dashboard/plans");
		revalidatePath("/dashboard/creator");
		return { success: true };
	});
}

export async function getCreatorPlans() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await listPlans(sessionPrincipal(session.user.id), { limit: 100 }),
	})).then((res) => res.data ?? []);
}

export async function getPlanDetails(planId: string) {
	return authenticatedAction(async (session) => {
		const plan = await db.query.plans.findFirst({
			where: and(eq(plans.id, planId), eq(plans.creatorId, session.user.id)),
			with: {
				versions: { orderBy: [desc(planVersions.version)] },
				integration: { with: { calcomIntegration: true } },
			},
		});
		if (!plan) return { success: false, error: "Plan not found" };
		const [enrolled, billingSubscriptions] = await Promise.all([
			db.query.enrollments.findMany({
				where: and(
					eq(enrollments.planId, planId),
					eq(enrollments.creatorId, session.user.id),
				),
				with: {
					user: { columns: { id: true, name: true, email: true, image: true } },
				},
				orderBy: [desc(enrollments.updatedAt)],
			}),
			db.query.subscriptions.findMany({
				where: and(
					eq(subscriptions.planId, planId),
					eq(subscriptions.creatorId, session.user.id),
					or(
						inArray(subscriptions.status, [
							"pending",
							"incomplete",
							"active",
							"past_due",
						]),
						and(
							eq(subscriptions.status, "canceled"),
							isNotNull(subscriptions.stripeSubscriptionId),
						),
					),
				),
				orderBy: [desc(subscriptions.createdAt)],
				columns: {
					userId: true,
					status: true,
					paidThroughAt: true,
					cancelAtPeriodEnd: true,
					cancelAt: true,
				},
			}),
		]);
		const balances = await usableBalances(
			db,
			enrolled.map((enrollment) => enrollment.id),
		);
		return {
			success: true,
			data: {
				plan,
				enrollments: enrolled.map((enrollment) => {
					const subscription = billingSubscriptions.find(
						(row) => row.userId === enrollment.userId,
					);
					return {
						...enrollment,
						credits: balances.get(enrollment.id) ?? 0,
						subscription: subscription
							? {
									...subscription,
									overdue: isSubscriptionOverdue(
										subscription.status,
										subscription.paidThroughAt,
									),
								}
							: null,
					};
				}),
			},
		};
	});
}

export async function updatePlanAction(
	identifier: string,
	input: {
		name?: string;
		description?: string | null;
		terms?: {
			billingMode?: "one_time" | "recurring";
			currency?: "usd" | "eur";
			price?: number;
			credits?: number;
			interval?: "month" | null;
		};
	},
) {
	return authenticatedAction(async (session) => {
		const result = await updatePlan(
			sessionPrincipal(session.user.id),
			identifier,
			input,
		);
		revalidatePath("/dashboard/plans");
		revalidatePath("/dashboard/creator");
		return { success: true, data: result };
	});
}

/** Publish the draft as the plan's sellable offer on the creator's Stripe account. */
export async function publishPlanAction(identifier: string) {
	return authenticatedAction(async (session) => {
		const result = await publishPlan(sessionPrincipal(session.user.id), {
			plan: identifier,
		});
		revalidatePath("/dashboard/plans");
		revalidatePath("/dashboard/creator");
		revalidatePath("/dashboard/payments");
		return { success: true, data: result };
	});
}

/** Stop new sales. Existing customers and purchases are unaffected. */
export async function unpublishPlanAction(identifier: string) {
	return authenticatedAction(async (session) => {
		const result = await unpublishPlan(sessionPrincipal(session.user.id), {
			plan: identifier,
			confirm: true,
		});
		revalidatePath("/dashboard/plans");
		revalidatePath("/dashboard/creator");
		revalidatePath("/dashboard/payments");
		return { success: true, data: result };
	});
}
