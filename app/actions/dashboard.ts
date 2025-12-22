"use server";

import { and, count, countDistinct, eq, inArray, sum } from "drizzle-orm";
import { db } from "@/app/db";
import {
	liteSubscriptions,
	products,
	transactions,
	userBalances,
} from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

export async function getCreatorStats() {
	return authenticatedAction(async (session) => {
		const [revenueResult] = await db
			.select({ value: sum(products.price) })
			.from(transactions)
			.innerJoin(products, eq(transactions.productId, products.id))
			.where(
				and(
					eq(transactions.creatorId, session.user.id),
					eq(transactions.type, "purchase"),
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

		if (subs.length === 0) {
			return { success: true, data: [] };
		}

		// Group subscriptions by creator
		const subsByCreator = subs.reduce(
			(acc, sub) => {
				if (!acc[sub.creatorId]) {
					acc[sub.creatorId] = {
						creator: sub.creator,
						subscriptions: [],
						packs: [], // Initialize packs here
					};
				}
				acc[sub.creatorId].subscriptions.push(sub);
				// Add the specific product from the subscription to packs
				if (sub.product) {
					acc[sub.creatorId].packs.push(sub.product);
				}
				return acc;
			},
			{} as Record<
				string,
				{ creator: any; subscriptions: (typeof subs)[0][]; packs: (typeof products.$inferSelect)[] }
			>,
		);

		const data = Object.values(subsByCreator);

		return { success: true, data };
	}).then((res) => res.data || []);
}
