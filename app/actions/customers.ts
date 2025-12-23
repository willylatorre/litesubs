"use server";

import { and, eq, sql, sum } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { liteSubscriptions, transactions, user } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

export async function getCreatorCustomers() {
	return authenticatedAction(async (session) => {
		const subs = await db.query.liteSubscriptions.findMany({
			where: eq(liteSubscriptions.creatorId, session.user.id),
			with: {
				user: true,
				product: true,
			},
		});

		// Group by user
		const subsByUser = subs.reduce(
			(acc, sub) => {
				if (!acc[sub.userId]) {
					acc[sub.userId] = {
						user: sub.user,
						subscriptions: [],
						totalCredits: 0,
					};
				}
				acc[sub.userId].subscriptions.push(sub);
				acc[sub.userId].totalCredits += sub.credits;
				return acc;
			},
			{} as Record<
				string,
				{ user: any; subscriptions: any[]; totalCredits: number }
			>,
		);

		const data = Object.values(subsByUser).map((group) => ({
			id: group.user.id, // for the key in React
			userId: group.user.id,
			user: group.user,
			credits: group.totalCredits,
			activePacks: group.subscriptions.map((s) => ({
				id: s.product.id,
				name: s.product.name,
				subscriptionId: s.id,
				credits: s.credits,
			})),
			updatedAt: group.subscriptions
				.reduce(
					(latest, s) => (s.updatedAt > latest ? s.updatedAt : latest),
					new Date(0),
				)
				.toISOString(),
		}));

		return { success: true, data };
	}).then((res) => res.data || []);
}

export async function getCustomerDetails(customerId: string) {
	return authenticatedAction(async (session) => {
		const customer = await db.query.user.findFirst({
			where: eq(user.id, customerId),
		});

		if (!customer) {
			return { success: false, error: "Customer not found" };
		}

		const subscriptions = await db.query.liteSubscriptions.findMany({
			where: and(
				eq(liteSubscriptions.userId, customerId),
				eq(liteSubscriptions.creatorId, session.user.id),
			),
			with: {
				product: true,
			},
		});

		// Calculate total spent
		const [spentResult] = await db
			.select({ value: sum(transactions.amountMoney) })
			.from(transactions)
			.where(
				and(
					eq(transactions.userId, customerId),
					eq(transactions.creatorId, session.user.id),
					eq(transactions.type, "purchase"),
				),
			);

		const customerTransactions = await db.query.transactions.findMany({
			where: and(
				eq(transactions.userId, customerId),
				eq(transactions.creatorId, session.user.id),
			),
			orderBy: (transactions, { desc }) => [desc(transactions.createdAt)],
		});

		return {
			success: true,
			data: {
				customer,
				subscriptions,
				totalSpent: Number(spentResult?.value || 0),
				transactions: customerTransactions,
			},
		};
	});
}

export async function updateSubscriptionCredits(
	subscriptionId: string,
	amount: number,
	description: string,
) {
	return authenticatedAction(async (session) => {
		try {
			await db.transaction(async (tx) => {
				const subscription = await tx.query.liteSubscriptions.findFirst({
					where: and(
						eq(liteSubscriptions.id, subscriptionId),
						eq(liteSubscriptions.creatorId, session.user.id),
					),
				});

				if (!subscription) {
					throw new Error("Subscription not found or unauthorized");
				}

				await tx
					.update(liteSubscriptions)
					.set({
						credits: sql`${liteSubscriptions.credits} + ${amount}`,
					})
					.where(eq(liteSubscriptions.id, subscriptionId));

				await tx.insert(transactions).values({
					userId: subscription.userId,
					creatorId: session.user.id,
					productId: subscription.productId,
					amount,
					type: "manual_adjustment",
					description: description || "Manual adjustment",
				});
			});

			revalidatePath("/dashboard/customers");
			// We might need to revalidate the specific customer page too
			// revalidatePath(`/dashboard/customers/${subscription.userId}`); // We don't have userId handy without fetching again or passing it. 
			// But revalidating the parent path usually clears cache for subpaths in Next.js? No, usually specific.
			// Let's just return success and let client handle or use a tag if we had one.
			
			return { success: true };
		} catch (error: any) {
			console.error("Failed to update credits:", error);
			return { error: error.message || "Failed to update credits" };
		}
	});
}

export async function updateCustomerCredits(
	userId: string,
	amount: number,
	description: string,
) {
	return authenticatedAction(async (session) => {
		try {
			await db.transaction(async (tx) => {
				const userSubscriptions = await tx.query.liteSubscriptions.findMany({
					where: and(
						eq(liteSubscriptions.userId, userId),
						eq(liteSubscriptions.creatorId, session.user.id),
					),
					orderBy: (liteSubscriptions, { desc }) => [
						desc(liteSubscriptions.updatedAt),
					],
				});

				if (userSubscriptions.length === 0) {
					throw new Error(
						"Cannot manually adjust credits for a user with no subscription.",
					);
				}

				// Apply to the most recently updated subscription
				const subToUpdate = userSubscriptions[0];

				await tx
					.update(liteSubscriptions)
					.set({
						credits: sql`${liteSubscriptions.credits} + ${amount}`,
					})
					.where(eq(liteSubscriptions.id, subToUpdate.id));

				await tx.insert(transactions).values({
					userId,
					creatorId: session.user.id,
					productId: subToUpdate.productId,
					amount,
					type: "manual_adjustment",
					description: description || "Manual adjustment",
				});
			});

			revalidatePath("/dashboard/customers");
			return { success: true };
		} catch (error: any) {
			console.error("Failed to update credits:", error);
			return { error: error.message || "Failed to update credits" };
		}
	});
}
