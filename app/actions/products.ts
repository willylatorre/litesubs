"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/app/db";
import { products } from "@/app/db/schema";
import { auth } from "@/lib/auth";

const createProductSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional(),
	price: z.coerce.number().min(0, "Price must be positive"),
	credits: z.coerce.number().int().min(1, "Credits must be at least 1"),
});

export type ProductActionState = {
	error?: string;
	fieldErrors?: {
		name?: string[];
		description?: string[];
		price?: string[];
		credits?: string[];
	};
	success?: boolean;
};

export async function createProduct(
	prevState: ProductActionState,
	formData: FormData,
): Promise<ProductActionState> {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return { error: "Unauthorized" };
	}

	const rawData = {
		name: formData.get("name"),
		description: formData.get("description"),
		price: formData.get("price"),
		credits: formData.get("credits"),
	};

	const validated = createProductSchema.safeParse(rawData);

	if (!validated.success) {
		return {
			error: "Validation failed",
			fieldErrors: validated.error.flatten().fieldErrors,
		};
	}

	const { name, description, price, credits } = validated.data;

	try {
		await db.insert(products).values({
			creatorId: session.user.id,
			name,
			description: description || "",
			price: Math.round(price * 100), // Convert to cents
			credits,
			type: "one_time",
			active: true,
		});

		revalidatePath("/dashboard/packs");
		return { success: true };
	} catch (error) {
		console.error("Failed to create product:", error);
		return { error: "Failed to create product" };
	}
}

export async function getCreatorProducts() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return [];
	}

	const data = await db.query.products.findMany({
		where: eq(products.creatorId, session.user.id),
		orderBy: [desc(products.createdAt)],
	});

	return data;
}

export async function toggleProductStatus(id: string, currentStatus: boolean) {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return { error: "Unauthorized" };
	}

	// Verify ownership
	const product = await db.query.products.findFirst({
		where: eq(products.id, id),
	});

	if (!product || product.creatorId !== session.user.id) {
		return { error: "Unauthorized" };
	}

	try {
		await db
			.update(products)
			.set({ active: !currentStatus })
			.where(eq(products.id, id));

		revalidatePath("/dashboard/packs");
		return { success: true };
	} catch (err) {
		return { error: "Failed to update status" };
	}
}
