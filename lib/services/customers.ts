import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { liteSubscriptions, transactions, user } from "@/app/db/schema";
import { pageInput, resolvePlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";

export async function resolveCustomer(
	principal: Principal,
	identifier: string,
) {
	const matches = await db
		.selectDistinct({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.innerJoin(liteSubscriptions, eq(liteSubscriptions.userId, user.id))
		.where(
			and(
				eq(liteSubscriptions.creatorId, principal.creatorId),
				or(
					eq(user.id, identifier),
					sql`lower(${user.email}) = ${identifier.trim().toLowerCase()}`,
					sql`lower(${user.name}) = ${identifier.trim().toLowerCase()}`,
				),
			),
		);
	if (!matches.length)
		throw new ServiceError(
			"NOT_FOUND",
			"Customer not found in your enrollments",
			404,
		);
	if (matches.length > 1)
		throw new ServiceError(
			"AMBIGUOUS",
			"More than one customer matches; use an email or ID",
			409,
			matches,
		);
	return matches[0];
}

export async function listCustomers(principal: Principal, input: unknown = {}) {
	requireScope(principal, "customers:read");
	const page = pageInput.parse(input);
	const customers = await db
		.selectDistinct({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
		})
		.from(user)
		.innerJoin(liteSubscriptions, eq(liteSubscriptions.userId, user.id))
		.where(eq(liteSubscriptions.creatorId, principal.creatorId))
		.orderBy(user.id)
		.limit(page.limit)
		.offset(page.offset);
	if (!customers.length) return [];
	const subscriptions = await db.query.liteSubscriptions.findMany({
		where: and(
			eq(liteSubscriptions.creatorId, principal.creatorId),
			inArray(
				liteSubscriptions.userId,
				customers.map((c) => c.id),
			),
		),
		with: { product: true },
	});
	return customers.map((customer) => {
		const enrollments = subscriptions.filter((s) => s.userId === customer.id);
		return {
			id: customer.id,
			userId: customer.id,
			user: customer,
			credits: enrollments.reduce((sum, s) => sum + s.credits, 0),
			activePacks: enrollments.map((s) => ({
				id: s.productId,
				name: s.product.name,
				subscriptionId: s.id,
				credits: s.credits,
			})),
			updatedAt: new Date(
				Math.max(...enrollments.map((s) => s.updatedAt.getTime())),
			).toISOString(),
		};
	});
}

export async function getCustomer(principal: Principal, identifier: string) {
	requireScope(principal, "customers:read");
	const customer = await resolveCustomer(principal, identifier);
	const subscriptions = await db.query.liteSubscriptions.findMany({
		where: and(
			eq(liteSubscriptions.creatorId, principal.creatorId),
			eq(liteSubscriptions.userId, customer.id),
		),
		with: { product: true },
	});
	return { customer, subscriptions };
}

export async function listTransactions(
	principal: Principal,
	input: unknown = {},
) {
	requireScope(principal, "billing:read");
	const page = pageInput
		.extend({ customer: z.string().optional(), plan: z.string().optional() })
		.parse(input);
	const conditions = [eq(transactions.creatorId, principal.creatorId)];
	if (page.customer)
		conditions.push(
			eq(
				transactions.userId,
				(await resolveCustomer(principal, page.customer)).id,
			),
		);
	if (page.plan)
		conditions.push(
			eq(transactions.productId, (await resolvePlan(principal, page.plan)).id),
		);
	return db.query.transactions.findMany({
		where: and(...conditions),
		orderBy: [desc(transactions.createdAt), desc(transactions.id)],
		limit: page.limit,
		offset: page.offset,
		with: { product: true },
	});
}
