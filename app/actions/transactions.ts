"use server";

import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/app/db";
import { subscriptions, transactions } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

export async function checkTransactionStatus(
	planId: string,
	forSubscription = false,
) {
	return authenticatedAction(async (session) => {
		if (forSubscription) {
			const subscription = await db.query.subscriptions.findFirst({
				where: and(
					eq(subscriptions.userId, session.user.id),
					eq(subscriptions.planId, planId),
					eq(subscriptions.status, "active"),
					gt(subscriptions.paidThroughAt, new Date()),
				),
				orderBy: [desc(subscriptions.createdAt)],
			});
			return {
				success: true,
				data: { status: subscription ? "completed" : "pending" },
			};
		}
		// Look for a recent payment for this user and plan. The return page never
		// grants credits; it only observes what fulfillment already recorded.
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

		const transaction = await db.query.transactions.findFirst({
			where: and(
				eq(transactions.userId, session.user.id),
				eq(transactions.planId, planId),
				eq(transactions.type, "purchase"),
				gt(transactions.createdAt, fiveMinutesAgo),
			),
			orderBy: [desc(transactions.createdAt)],
		});

		if (transaction) {
			return { success: true, data: { status: transaction.status } };
		}

		return { success: true, data: { status: "pending" } };
	}).then((res) => res?.data || { status: "pending" });
}

export async function getCreatorCustomerTransactions(
	customerId: string,
	planId?: string,
) {
	return authenticatedAction(async (session) => {
		const conditions = [
			eq(transactions.userId, customerId),
			eq(transactions.creatorId, session.user.id),
		];

		if (planId) {
			conditions.push(eq(transactions.planId, planId));
		}

		const txs = await db.query.transactions.findMany({
			where: and(...conditions),
			orderBy: [desc(transactions.createdAt)],
			with: {
				plan: true,
				allocations: true,
			},
		});

		return { success: true, data: txs };
	});
}

export async function getUserTransactions(planId?: string) {
	return authenticatedAction(async (session) => {
		const conditions = [eq(transactions.userId, session.user.id)];

		if (planId) {
			conditions.push(eq(transactions.planId, planId));
		}

		const txs = await db.query.transactions.findMany({
			where: and(...conditions),
			orderBy: [desc(transactions.createdAt)],
			with: {
				creator: true,
				plan: true,
				// A usage debit is attributable: show which grants it consumed.
				allocations: true,
			},
		});

		return { success: true, data: txs };
	});
}
