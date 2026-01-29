"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { liteSubscriptions, products } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { createProductSchema } from "@/lib/schemas";

export async function createProduct(prevState: any, formData: FormData) {
	return authenticatedAction(async (session) => {
		const rawData = {
			name: formData.get("name"),
			description: formData.get("description"),
			price: formData.get("price"),
			credits: formData.get("credits"),
			currency: formData.get("currency"),
		};

		const validated = createProductSchema.safeParse(rawData);

		if (!validated.success) {
			return {
				error: "Validation failed",
				fieldErrors: validated.error.flatten().fieldErrors,
			};
		}

		const { name, description, price, credits, currency } = validated.data;

		await db.insert(products).values({
			creatorId: session.user.id,
			name,
			description: description || "",
			price: Math.round(price * 100), // Convert to cents
			credits,
			currency,
			type: "one_time",
			active: true,
		});

		revalidatePath("/dashboard/packs");
		return { success: true };
	});
}

export async function getCreatorProducts() {
	return authenticatedAction(async (session) => {
		const data = await db.query.products.findMany({
			where: eq(products.creatorId, session.user.id),
			orderBy: [desc(products.createdAt)],
			with: {
				integration: {
					with: {
						calcomIntegration: true,
					},
				},
			},
		});
		return { success: true, data };
	}).then((res) => res.data || []);
}

export async function toggleProductStatus(id: string, currentStatus: boolean) {
	return authenticatedAction(async (session) => {
		// Verify ownership
		const product = await db.query.products.findFirst({
			where: eq(products.id, id),
		});

		if (!product || product.creatorId !== session.user.id) {
			return { error: "Unauthorized" };
		}

		await db
			.update(products)
			.set({ active: !currentStatus })
			.where(eq(products.id, id));

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
			with: {
				integration: {
					with: {
						calcomIntegration: true,
					},
				},
			},
		});

		if (!product) {
			return { success: false, error: "Plan not found" };
		}

		const subscribers = await db.query.liteSubscriptions.findMany({
			where: eq(liteSubscriptions.productId, packId),
			with: {
				user: true,
			},
			orderBy: [desc(liteSubscriptions.updatedAt)],
		});

		return { success: true, data: { product, subscribers } };
	});
}
