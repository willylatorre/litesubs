"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import {
	type PayoutMethod,
	userPayoutPreferences,
} from "@/app/db/stripe-connect-schema";
import { authenticatedAction } from "@/lib/safe-action";

/**
 * Get the user's current payout method preference
 * Returns null if no preference is set (user hasn't chosen yet)
 */
export async function getPayoutPreference() {
	return authenticatedAction(async (session) => {
		const preference = await db.query.userPayoutPreferences.findFirst({
			where: eq(userPayoutPreferences.userId, session.user.id),
		});

		return {
			success: true,
			data: preference
				? {
						method: preference.method,
						createdAt: preference.createdAt,
						updatedAt: preference.updatedAt,
					}
				: null,
		};
	});
}

/**
 * Set the user's payout method preference
 * Can be either 'stripe_connect' or 'platform_payouts'
 */
export async function setPayoutPreference(method: PayoutMethod) {
	return authenticatedAction(
		async (session, method: PayoutMethod) => {
			const userId = session.user.id;

			// Check if preference already exists
			const existing = await db.query.userPayoutPreferences.findFirst({
				where: eq(userPayoutPreferences.userId, userId),
			});

			if (existing) {
				// Update existing preference
				await db
					.update(userPayoutPreferences)
					.set({
						method,
						updatedAt: new Date(),
					})
					.where(eq(userPayoutPreferences.userId, userId));
			} else {
				// Create new preference
				await db.insert(userPayoutPreferences).values({
					userId,
					method,
				});
			}

			revalidatePath("/dashboard/payouts");

			return {
				success: true,
				data: { method },
			};
		},
		method,
	);
}

/**
 * Clear the user's payout preference
 * This allows them to choose again (useful for switching methods)
 */
export async function clearPayoutPreference() {
	return authenticatedAction(async (session) => {
		await db
			.delete(userPayoutPreferences)
			.where(eq(userPayoutPreferences.userId, session.user.id));

		revalidatePath("/dashboard/payouts");

		return { success: true };
	});
}
