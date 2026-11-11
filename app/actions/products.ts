"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { liteSubscriptions, products } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { createPlan, listPlans, updatePlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";

export async function createProduct(_prevState: unknown, formData: FormData) {
	return authenticatedAction(async (session) => {
		await createPlan(sessionPrincipal(session.user.id), {
			name: formData.get("name"),
			description: formData.get("description") || undefined,
			price: Number(formData.get("price")),
			credits: Number(formData.get("credits")),
			currency: formData.get("currency") || "usd",
		});
		revalidatePath("/dashboard/packs");
		return { success: true };
	});
}
export async function getCreatorProducts() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await listPlans(sessionPrincipal(session.user.id), { limit: 100 }),
	})).then((res) => res.data ?? []);
}
export async function toggleProductStatus(id: string, currentStatus: boolean) {
	return authenticatedAction(async (session) => {
		await updatePlan(sessionPrincipal(session.user.id), id, {
			active: !currentStatus,
		});
		revalidatePath("/dashboard/packs");
		return { success: true };
	});
}
export async function getPackDetails(packId: string) {
	return authenticatedAction(async (session) => {
		const product = await db.query.products.findFirst({
			where: and(
				eq(products.id, packId),
				eq(products.creatorId, session.user.id),
			),
			with: { integration: { with: { calcomIntegration: true } } },
		});
		if (!product) return { success: false, error: "Plan not found" };
		const subscribers = await db.query.liteSubscriptions.findMany({
			where: and(
				eq(liteSubscriptions.productId, packId),
				eq(liteSubscriptions.creatorId, session.user.id),
			),
			with: {
				user: { columns: { id: true, name: true, email: true, image: true } },
			},
			orderBy: [desc(liteSubscriptions.updatedAt)],
		});
		return { success: true, data: { product, subscribers } };
	});
}
