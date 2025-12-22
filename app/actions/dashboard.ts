"use server";

import { and, count, eq, inArray, sum } from "drizzle-orm";
import { db } from "@/app/db";
import { products, transactions, userBalances } from "@/app/db/schema";
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
			.select({ count: count() })
			.from(userBalances)
			.where(eq(userBalances.creatorId, session.user.id));

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
			.from(userBalances)
			.where(eq(userBalances.userId, session.user.id));

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
		const balances = await db.query.userBalances.findMany({
			where: eq(userBalances.userId, session.user.id),
			with: {
				creator: true,
			},
		});

		if (balances.length === 0) {
			return { success: true, data: [] };
		}

		const creatorIds = balances.map((b) => b.creatorId);

		const creatorProducts = await db.query.products.findMany({
			where: and(
				inArray(products.creatorId, creatorIds),
				eq(products.active, true),
			),
		});

		const data = balances.map((balance) => ({
			...balance,
			packs: creatorProducts.filter((p) => p.creatorId === balance.creatorId),
		}));

		return { success: true, data };
	}).then((res) => res.data || []);
}
