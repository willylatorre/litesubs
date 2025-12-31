"use server";

import { and, count, countDistinct, eq, sum } from "drizzle-orm";
import { db } from "@/app/db";
import {
	invites,
	liteSubscriptions,
	products,
	transactions,
} from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

export async function getUserSubscriptionDetails(subscriptionId: string) {
	return authenticatedAction(async (session) => {
		const sub = await db.query.liteSubscriptions.findFirst({
			where: and(
				eq(liteSubscriptions.id, subscriptionId),
				eq(liteSubscriptions.userId, session.user.id),
			),
			with: {
				creator: true,
				product: true,
			},
		});

		if (!sub) {
			return { success: false, error: "Subscription not found" };
		}

		return { success: true, data: sub };
	});
}

export async function getDashboardData() {
	return authenticatedAction(async (session) => {
		const [statsResult, subsResult, invitesResult] = await Promise.all([
			// Consumer Stats
			(async () => {
				const [spentResult] = await db
					.select({ value: sum(transactions.amountMoney) })
					.from(transactions)
					.where(
						and(
							eq(transactions.userId, session.user.id),
							eq(transactions.type, "purchase"),
							eq(transactions.status, "completed"),
						),
					);

				const [subsCountResult] = await db
					.select({ count: count() })
					.from(liteSubscriptions)
					.where(eq(liteSubscriptions.userId, session.user.id));

				return {
					totalSpent: Number(spentResult?.value || 0),
					activeSubscriptionsCount: Number(subsCountResult?.count || 0),
				};
			})(),

			// User Subscriptions
			db.query.liteSubscriptions.findMany({
				where: eq(liteSubscriptions.userId, session.user.id),
				with: {
					creator: true,
					product: true,
				},
			}),

			// Pending Invites
			db.query.invites.findMany({
				where: and(
					eq(invites.email, session.user.email),
					eq(invites.status, "pending"),
				),
				with: {
					creator: true,
					product: true,
				},
			}),
		]);

		return {
			success: true,
			data: {
				stats: statsResult,
				subscriptions: subsResult,
				pendingInvites: invitesResult,
			},
		};
	}).then(
		(res) =>
			res.data || {
				stats: { totalSpent: 0, activeSubscriptionsCount: 0 },
				subscriptions: [],
				pendingInvites: [],
			},
	);
}

export async function getCreatorStats() {
	return authenticatedAction(async (session) => {
		const [revenueResult] = await db
			.select({ value: sum(transactions.amountMoney) })
			.from(transactions)
			.where(
				and(
					eq(transactions.creatorId, session.user.id),
					eq(transactions.type, "purchase"),
					eq(transactions.status, "completed"),
				),
			);

		const [productsResult] = await db
			.select({ count: count() })
			.from(products)
			.where(
				and(eq(products.creatorId, session.user.id), eq(products.active, true)),
			);

		const [customersResult] = await db
			.select({ count: countDistinct(liteSubscriptions.userId) })
			.from(liteSubscriptions)
			.where(eq(liteSubscriptions.creatorId, session.user.id));

		return {
			success: true,
			data: {
				totalRevenue: Number(revenueResult?.value || 0),
				activeProducts: Number(productsResult?.count || 0),
				totalCustomers: Number(customersResult?.count || 0),
			},
		};
	}).then(
		(res) =>
			res.data || {
				totalRevenue: 0,
				activeProducts: 0,
				totalCustomers: 0,
			},
	);
}

export async function getConsumerStats() {
	return authenticatedAction(async (session) => {
		const [spentResult] = await db
			.select({ value: sum(products.price) })
			.from(transactions)
			.innerJoin(products, eq(transactions.productId, products.id))
			.where(
				and(
					eq(transactions.userId, session.user.id),
					eq(transactions.type, "purchase"),
				),
			);

		const [subsResult] = await db
			.select({ count: count() })
			.from(liteSubscriptions)
			.where(eq(liteSubscriptions.userId, session.user.id));

		return {
			success: true,
			data: {
				totalSpent: Number(spentResult?.value || 0),
				activeSubscriptionsCount: Number(subsResult?.count || 0),
			},
		};
	}).then(
		(res) =>
			res.data || {
				totalSpent: 0,
				activeSubscriptionsCount: 0,
			},
	);
}

export async function getUserSubscriptions() {
	return authenticatedAction(async (session) => {
		const subs = await db.query.liteSubscriptions.findMany({
			where: eq(liteSubscriptions.userId, session.user.id),
			with: {
				creator: true,
				product: true,
			},
		});

		return { success: true, data: subs };
	}).then((res) => res.data || []);
}