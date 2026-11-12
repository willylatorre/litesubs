import { and, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { db } from "@/app/db";
import { creditGrants } from "@/app/db/schema";

export function usableGrantFilter() {
	return and(
		gt(creditGrants.remaining, 0),
		or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, new Date())),
	);
}

/** Batch read of spendable balances for customer/creator summaries. */
export async function usableBalances(
	client: Pick<typeof db, "select">,
	enrollmentIds: string[],
) {
	if (enrollmentIds.length === 0) return new Map<string, number>();
	const rows = await client
		.select({
			enrollmentId: creditGrants.enrollmentId,
			total: sql<number>`coalesce(sum(${creditGrants.remaining}), 0)::int`,
		})
		.from(creditGrants)
		.where(
			and(
				inArray(creditGrants.enrollmentId, enrollmentIds),
				usableGrantFilter(),
			),
		)
		.groupBy(creditGrants.enrollmentId);
	return new Map(rows.map((row) => [row.enrollmentId, row.total]));
}

/** Sum currently spendable grants; expired units are excluded even if unmaterialized. */
export async function usableBalance(
	client: Pick<typeof db, "select">,
	enrollmentId: string,
) {
	const balances = await usableBalances(client, [enrollmentId]);
	return balances.get(enrollmentId) ?? 0;
}
