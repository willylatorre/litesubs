"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { calComAccounts } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

export async function getCalAccountStatus() {
	return authenticatedAction(async (session) => {
		const account = await db.query.calComAccounts.findFirst({
			where: eq(calComAccounts.userId, session.user.id),
		});

		if (!account) {
			return { success: true, data: null };
		}

		// This is an exported server action, so anything returned here is
		// serialized to the client. Never include accessToken/refreshToken.
		return {
			success: true,
			data: {
				connected: true,
				calUserId: account.calUserId,
				calUsername: account.calUsername,
				scope: account.scope,
				expiresAt: account.expiresAt,
				connectedAt: account.createdAt,
			},
		};
	});
}

export async function disconnectCalAccount() {
	return authenticatedAction(async (session) => {
		await db
			.delete(calComAccounts)
			.where(eq(calComAccounts.userId, session.user.id));

		revalidatePath("/dashboard/integrations");
		return { success: true };
	});
}
