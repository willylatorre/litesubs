import { db } from "@/app/db";
import { subscription } from "@/app/db/schema";

/**
 * Give a test creator a paid Premium tier.
 *
 * Recurring plans and developer features are Premium-only, so a test that
 * exercises them has to say so instead of inheriting a free tier by accident.
 * `periodEnd` is in the future on purpose: entitlement follows the paid period,
 * not Stripe's status, and a fixture with no period would read as ended.
 *
 * The row is the plugin's own shape (`referenceId`, `plan`), because that is what
 * `getEntitlement` reads. Nothing writes a `tier` column any more.
 */
export async function grantTestPremium(creatorId: string) {
	const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
	await db
		.insert(subscription)
		.values({
			id: `test-sub-${creatorId}`,
			plan: "premium",
			referenceId: creatorId,
			status: "active",
			periodStart: new Date(),
			periodEnd,
			// The fixture must state the paid boundary too. Entitlement reads this
			// column, so a fixture that only set `periodEnd` would read as "nothing
			// provably paid" and silently test the free tier.
			paidThroughAt: periodEnd,
		})
		.onConflictDoUpdate({
			target: subscription.referenceId,
			set: {
				plan: "premium",
				status: "active",
				periodEnd,
				paidThroughAt: periodEnd,
			},
		});
}
