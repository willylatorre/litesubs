import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { enrollments, transactions, user } from "@/app/db/schema";
import { pageInput, resolvePlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";

export async function resolveCustomer(
	principal: Principal,
	identifier: string,
) {
	const matches = await db
		.selectDistinct({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.innerJoin(enrollments, eq(enrollments.userId, user.id))
		.where(
			and(
				eq(enrollments.creatorId, principal.creatorId),
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
		.innerJoin(enrollments, eq(enrollments.userId, user.id))
		.where(eq(enrollments.creatorId, principal.creatorId))
		.orderBy(user.id)
		.limit(page.limit)
		.offset(page.offset);
	if (!customers.length) return [];
	const rows = await db.query.enrollments.findMany({
		where: and(
			eq(enrollments.creatorId, principal.creatorId),
			inArray(
				enrollments.userId,
				customers.map((c) => c.id),
			),
		),
		with: { plan: true },
	});
	return customers.map((customer) => {
		const owned = rows.filter((row) => row.userId === customer.id);
		return {
			id: customer.id,
			userId: customer.id,
			user: customer,
			credits: owned.reduce((sum, row) => sum + row.credits, 0),
			enrollments: owned.map((row) => ({
				id: row.planId,
				name: row.plan.name,
				enrollmentId: row.id,
				credits: row.credits,
			})),
			updatedAt: new Date(
				Math.max(...owned.map((row) => row.updatedAt.getTime())),
			).toISOString(),
		};
	});
}

export async function getCustomer(principal: Principal, identifier: string) {
	requireScope(principal, "customers:read");
	const customer = await resolveCustomer(principal, identifier);
	const rows = await db.query.enrollments.findMany({
		where: and(
			eq(enrollments.creatorId, principal.creatorId),
			eq(enrollments.userId, customer.id),
		),
		with: { plan: true },
	});
	return { customer, enrollments: rows };
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
			eq(transactions.planId, (await resolvePlan(principal, page.plan)).id),
		);
	return db.query.transactions.findMany({
		where: and(...conditions),
		orderBy: [desc(transactions.createdAt), desc(transactions.id)],
		limit: page.limit,
		offset: page.offset,
		with: { plan: true },
	});
}
