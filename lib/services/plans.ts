import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { liteSubscriptions, products } from "@/app/db/schema";
import { createProductSchema } from "@/lib/schemas";
import { type Principal, requireScope, ServiceError } from "./principal";

export const planInput = createProductSchema.extend({
	name: z.string().trim().min(1).max(200),
	description: z.string().max(5000).optional(),
	price: z.number().finite().min(0).max(1000000),
	credits: z.number().int().min(1).max(1000000),
});
export const updatePlanInput = planInput
	.partial()
	.extend({ active: z.boolean().optional() });
export const pageInput = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

// Resolve exact IDs/names only within this creator. Never guess a fuzzy match.
export async function resolvePlan(principal: Principal, identifier: string) {
	const matches = await db.query.products.findMany({
		where: and(
			eq(products.creatorId, principal.creatorId),
			or(
				eq(products.id, identifier),
				sql`lower(${products.name}) = ${identifier.trim().toLowerCase()}`,
			),
		),
	});
	if (!matches.length)
		throw new ServiceError("NOT_FOUND", "Plan not found", 404);
	if (matches.length > 1)
		throw new ServiceError(
			"AMBIGUOUS",
			"More than one plan matches; use its ID",
			409,
			matches.map(({ id, name }) => ({ id, name })),
		);
	return matches[0];
}

export async function listPlans(principal: Principal, input: unknown = {}) {
	requireScope(principal, "plans:read");
	const page = pageInput.parse(input);
	return db.query.products.findMany({
		where: eq(products.creatorId, principal.creatorId),
		orderBy: [desc(products.createdAt), desc(products.id)],
		...page,
		with: { integration: { with: { calcomIntegration: true } } },
	});
}

export async function getPlan(principal: Principal, identifier: string) {
	requireScope(principal, "plans:read");
	const product = await resolvePlan(principal, identifier);
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(liteSubscriptions)
		.where(
			and(
				eq(liteSubscriptions.productId, product.id),
				eq(liteSubscriptions.creatorId, principal.creatorId),
			),
		);
	return { ...product, enrollmentCount: count };
}

export async function createPlan(principal: Principal, input: unknown) {
	requireScope(principal, "plans:write");
	const data = planInput.parse(input);
	const [result] = await db
		.insert(products)
		.values({
			...data,
			price: Math.round(data.price * 100),
			creatorId: principal.creatorId,
		})
		.returning();
	return result;
}

export async function updatePlan(
	principal: Principal,
	identifier: string,
	input: unknown,
) {
	requireScope(principal, "plans:write");
	const data = updatePlanInput.parse(input);
	if (!Object.keys(data).length)
		throw new ServiceError(
			"INVALID_INPUT",
			"Provide at least one field to update",
		);
	const plan = await resolvePlan(principal, identifier);
	const [result] = await db
		.update(products)
		.set({
			...data,
			...(data.price === undefined
				? {}
				: { price: Math.round(data.price * 100) }),
		})
		.where(
			and(
				eq(products.id, plan.id),
				eq(products.creatorId, principal.creatorId),
			),
		)
		.returning();
	return result;
}
