"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/app/db";
import { transactions, userBalances } from "@/app/db/schema";
import { auth } from "@/lib/auth";

export async function getCreatorCustomers() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return [];

	const balances = await db.query.userBalances.findMany({
		where: eq(userBalances.creatorId, session.user.id),
		with: {
			user: true,
		},
	});

	return balances;
}

export async function updateCustomerCredits(
	userId: string,
	amount: number,
	description: string,
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return { error: "Unauthorized" };

	try {
		await db.transaction(async (tx) => {
			// Verify balance exists
			const currentBalance = await tx.query.userBalances.findFirst({
				where: and(
					eq(userBalances.userId, userId),
					eq(userBalances.creatorId, session.user.id),
				),
			});

			if (!currentBalance && amount < 0) {
				throw new Error("Cannot deduct from non-existent balance");
			}

			// If no balance and adding, create it
			if (!currentBalance) {
				await tx.insert(userBalances).values({
					userId,
					creatorId: session.user.id,
					credits: amount,
				});
			} else {
				await tx
					.update(userBalances)
					.set({
						credits: sql`${userBalances.credits} + ${amount}`,
						updatedAt: new Date(),
					})
					.where(eq(userBalances.id, currentBalance.id));
			}

			await tx.insert(transactions).values({
				userId,
				creatorId: session.user.id,
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
}
