"use server";

import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import { calComAccounts } from "@/app/db/schema";
import { revalidatePath } from "next/cache";
import { authenticatedAction } from "@/lib/safe-action";

export async function getCalAccountStatus() {
	return authenticatedAction(async (session) => {
		const account = await db.query.calComAccounts.findFirst({
			where: eq(calComAccounts.userId, session.user.id),
		});

		return { success: true, data: account };
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
