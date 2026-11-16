"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { calcomIntegrations, integrations, plans } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { ServiceError } from "@/lib/services/principal";

/**
 * Attach or clear the Cal.com event type for a plan. Thin wrapper over the plan
 * service so creators can manage the booking integration from the same
 * authorized surface as the rest of the plan.
 */
export async function setPlanCalEventType(
	planId: string,
	eventType: {
		id: number;
		slug?: string | null;
		name?: string | null;
		url?: string | null;
	} | null,
) {
	return authenticatedAction(async (session) => {
		const plan = await db.query.plans.findFirst({
			where: and(eq(plans.id, planId), eq(plans.creatorId, session.user.id)),
		});
		if (!plan) throw new ServiceError("NOT_FOUND", "Plan not found", 404);

		await db.transaction(async (tx) => {
			if (!eventType) {
				if (plan.integrationId) {
					await tx
						.update(plans)
						.set({ integrationId: null })
						.where(eq(plans.id, plan.id));
					await tx
						.delete(integrations)
						.where(eq(integrations.id, plan.integrationId));
				}
				return;
			}

			if (plan.integrationId) {
				const integration = await tx.query.integrations.findFirst({
					where: eq(integrations.id, plan.integrationId),
				});
				if (integration?.calcomIntegrationId) {
					await tx
						.update(calcomIntegrations)
						.set({
							eventTypeId: eventType.id,
							eventTypeSlug: eventType.slug ?? null,
							eventTypeName: eventType.name ?? null,
							eventTypeUrl: eventType.url ?? null,
							connectedAt: new Date(),
						})
						.where(eq(calcomIntegrations.id, integration.calcomIntegrationId));
					return;
				}
			}

			const [calcomIntegration] = await tx
				.insert(calcomIntegrations)
				.values({
					eventTypeId: eventType.id,
					eventTypeSlug: eventType.slug ?? null,
					eventTypeName: eventType.name ?? null,
					eventTypeUrl: eventType.url ?? null,
					connectedAt: new Date(),
				})
				.returning();
			if (plan.integrationId) {
				await tx
					.update(integrations)
					.set({
						type: "calcom",
						calcomIntegrationId: calcomIntegration.id,
					})
					.where(eq(integrations.id, plan.integrationId));
				return;
			}
			const [integration] = await tx
				.insert(integrations)
				.values({
					userId: session.user.id,
					type: "calcom",
					calcomIntegrationId: calcomIntegration.id,
				})
				.returning();
			await tx
				.update(plans)
				.set({ integrationId: integration.id })
				.where(eq(plans.id, plan.id));
		});

		revalidatePath("/dashboard/plans");
		revalidatePath("/dashboard/creator");
		return { success: true };
	});
}
