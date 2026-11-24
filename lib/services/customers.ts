import {
	and,
	desc,
	eq,
	exists,
	inArray,
	isNotNull,
	or,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import {
	creatorCustomers,
	enrollments,
	subscriptions,
	transactions,
	user,
} from "@/app/db/schema";
import { isSubscriptionOverdue } from "@/lib/subscription-state";
import { usableBalances } from "./credit-balance";
import { pageInput, resolvePlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";
import { moneyByCurrency } from "./reporting";

export async function resolveCustomer(
	principal: Principal,
	identifier: string,
) {
	const matches = await db
		.selectDistinct({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(
			and(
				// A customer is "this creator's" either through an enrollment (they
				// bought or were enrolled) or through a provisioning link (a teacher
				// created them before any purchase). Reading only enrollments made a
				// freshly provisioned learner invisible: `POST /customers` returned an
				// id that every follow-up call rejected with `NOT_FOUND`.
				or(
					exists(
						db
							.select({ one: sql`1` })
							.from(enrollments)
							.where(
								and(
									eq(enrollments.userId, user.id),
									eq(enrollments.creatorId, principal.creatorId),
								),
							),
					),
					exists(
						db
							.select({ one: sql`1` })
							.from(creatorCustomers)
							.where(
								and(
									eq(creatorCustomers.userId, user.id),
									eq(creatorCustomers.creatorId, principal.creatorId),
								),
							),
					),
				),
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
	// A customer is this creator's through an enrollment *or* a provisioning
	// link. Reading enrollments alone hid every provisioned learner until their
	// first purchase, so the caller that just created them could not see them.
	const customers = await db
		.selectDistinct({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
		})
		.from(user)
		.where(
			or(
				exists(
					db
						.select({ one: sql`1` })
						.from(enrollments)
						.where(
							and(
								eq(enrollments.userId, user.id),
								eq(enrollments.creatorId, principal.creatorId),
							),
						),
				),
				exists(
					db
						.select({ one: sql`1` })
						.from(creatorCustomers)
						.where(
							and(
								eq(creatorCustomers.userId, user.id),
								eq(creatorCustomers.creatorId, principal.creatorId),
							),
						),
				),
			),
		)
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
				planId: true,
				status: true,
				paidThroughAt: true,
				cancelAtPeriodEnd: true,
				cancelAt: true,
				cancellationCause: true,
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
	return Promise.all(
		customers.map(async (customer) => {
			const owned = viewRows.filter((row) => row.userId === customer.id);
			return {
				id: customer.id,
				userId: customer.id,
				user: customer,
				credits: owned.reduce((sum, row) => sum + row.credits, 0),
				/** Confirmed money this customer paid this creator, per currency. */
				money: await moneyByCurrency({
					kind: "customer",
					id: customer.id,
					creatorId: principal.creatorId,
				}),
				enrollments: owned.map((row) => ({
					id: row.planId,
					name: row.plan.name,
					enrollmentId: row.id,
					credits: row.credits,
					billingSubscription: row.billingSubscription,
				})),
				updatedAt: new Date(
					owned.length
						? Math.max(...owned.map((row) => row.updatedAt.getTime()))
						: Date.now(),
				).toISOString(),
			};
		}),
	);
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
				planId: true,
				status: true,
				paidThroughAt: true,
				cancelAtPeriodEnd: true,
				cancelAt: true,
				cancellationCause: true,
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
		money: await moneyByCurrency({
			kind: "customer",
			id: customer.id,
			creatorId: principal.creatorId,
		}),
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

/**
 * The transaction fields a client may see.
 *
 * The table also holds the platform's internal Stripe linkage — the Checkout
 * session id, the creator's connected account id, the application fee — which is
 * bookkeeping for reconciliation, not part of the integration contract. Spreading
 * the row published all of it to any key holding `billing:read`: a consumer could
 * read the creator's connected account id and the exact Checkout session behind
 * every sale, and had no use for either.
 *
 * Fields are listed explicitly rather than derived, so adding an internal column
 * does not silently publish it.
 */
const TRANSACTION_COLUMNS = {
	id: true,
	userId: true,
	planId: true,
	planVersionId: true,
	amount: true,
	amountMoney: true,
	currency: true,
	type: true,
	status: true,
	description: true,
	balanceBefore: true,
	balanceAfter: true,
	idempotencyKey: true,
	createdAt: true,
} as const;

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
	const rows = await db.query.transactions.findMany({
		where: and(...conditions),
		orderBy: [desc(transactions.createdAt), desc(transactions.id)],
		limit: page.limit,
		offset: page.offset,
		columns: TRANSACTION_COLUMNS,
		with: {
			plan: {
				columns: {
					id: true,
					name: true,
					description: true,
				},
			},
		},
	});
	return rows;
}
