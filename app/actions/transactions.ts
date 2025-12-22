"use server";

import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/app/db";
import { transactions } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

export async function checkTransactionStatus(productId: string) {
	return authenticatedAction(async (session) => {
		// Look for a recent transaction for this user and product
		// We can look for transactions created in the last few minutes
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

		const transaction = await db.query.transactions.findFirst({
			where: and(
				eq(transactions.userId, session.user.id),
				eq(transactions.productId, productId),
				eq(transactions.type, "purchase"),
				gt(transactions.createdAt, fiveMinutesAgo)
			),
			orderBy: [desc(transactions.createdAt)],
		});

		if (transaction) {
			return { success: true, status: transaction.status };
		}

		return { success: true, status: "pending" };
	});
}
