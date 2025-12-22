"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { liteSubscriptions, transactions } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

export async function getCreatorCustomers() {
	return authenticatedAction(async (session) => {
		const subs = await db.query.liteSubscriptions.findMany({
			where: eq(liteSubscriptions.creatorId, session.user.id),
			with: {
				user: true,
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
