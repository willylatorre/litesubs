import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import {
	enrollments,
	subscriptions,
	transactions,
	user,
} from "@/app/db/schema";
import { isSubscriptionOverdue } from "@/lib/subscription-state";
import { usableBalances } from "./credit-balance";
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
	const [rows, subscriptionRows] = await Promise.all([
		db.query.enrollments.findMany({
			where: and(
				eq(enrollments.creatorId, principal.creatorId),
				inArray(
					enrollments.userId,
					customers.map((c) => c.id),
				),
			),
			with: { plan: true },
		}),
		db.query.subscriptions.findMany({
			where: and(
				eq(subscriptions.creatorId, principal.creatorId),
				inArray(
					subscriptions.userId,
					customers.map((c) => c.id),
				),
				inArray(subscriptions.status, [
					"pending",
					"incomplete",
					"active",
					"past_due",
				]),
			),
			orderBy: [desc(subscriptions.createdAt)],
			columns: {
				userId: true,
				planId: true,
				status: true,
				paidThroughAt: true,
				cancelAtPeriodEnd: true,
			},
		}),
	]);
	const balances = await usableBalances(
		db,
		rows.map((row) => row.id),
	);
	const currentSubscriptions = new Map<
		string,
		(typeof subscriptionRows)[number]
	>();
	for (const subscription of subscriptionRows) {
		const key = JSON.stringify([subscription.userId, subscription.planId]);
		if (!currentSubscriptions.has(key))
			currentSubscriptions.set(key, subscription);
	}
	const viewRows = rows.map((row) => {
		const subscription = currentSubscriptions.get(
			JSON.stringify([row.userId, row.planId]),
		);
		return {
			...row,
			credits: balances.get(row.id) ?? 0,
			billingSubscription: subscription
				? {
						...subscription,
						overdue: isSubscriptionOverdue(
							subscription.status,
							subscription.paidThroughAt,
						),
					}
				: null,
		};
	});
	return customers.map((customer) => {
		const owned = viewRows.filter((row) => row.userId === customer.id);
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
				billingSubscription: row.billingSubscription,
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
	const [rows, subscriptionRows] = await Promise.all([
		db.query.enrollments.findMany({
			where: and(
				eq(enrollments.creatorId, principal.creatorId),
				eq(enrollments.userId, customer.id),
			),
			with: { plan: true },
		}),
		db.query.subscriptions.findMany({
			where: and(
				eq(subscriptions.creatorId, principal.creatorId),
				eq(subscriptions.userId, customer.id),
				inArray(subscriptions.status, [
					"pending",
					"incomplete",
					"active",
					"past_due",
				]),
			),
			orderBy: [desc(subscriptions.createdAt)],
			columns: {
				planId: true,
				status: true,
				paidThroughAt: true,
				cancelAtPeriodEnd: true,
			},
		}),
	]);
	const balances = await usableBalances(
		db,
		rows.map((row) => row.id),
	);
	const currentSubscriptions = new Map<
		string,
		(typeof subscriptionRows)[number]
	>();
	for (const subscription of subscriptionRows) {
		if (!currentSubscriptions.has(subscription.planId))
			currentSubscriptions.set(subscription.planId, subscription);
	}
	return {
		customer,
		enrollments: rows.map((row) => {
			const subscription = currentSubscriptions.get(row.planId);
			return {
				...row,
				credits: balances.get(row.id) ?? 0,
				billingSubscription: subscription
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
	};
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
