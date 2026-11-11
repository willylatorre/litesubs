"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { enrollments, plans, planVersions } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { createPlan, listPlans, updatePlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";

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
		const enrolled = await db.query.enrollments.findMany({
			where: and(
				eq(enrollments.planId, planId),
				eq(enrollments.creatorId, session.user.id),
			),
			with: {
				user: { columns: { id: true, name: true, email: true, image: true } },
			},
			orderBy: [desc(enrollments.updatedAt)],
		});
		return {
			success: true,
			data: { plan, enrollments: enrolled },
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
