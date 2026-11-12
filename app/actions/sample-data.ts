"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import {
	creditAllocations,
	creditGrants,
	enrollments,
	invites,
	plans,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import { type ActionResponse, authenticatedAction } from "@/lib/safe-action";
import {
	SAMPLE_CUSTOMER_NAME,
	SAMPLE_PLAN,
	sampleIds,
} from "@/lib/sample-data";

export type SampleWorkspaceState = {
	loaded: boolean;
	planId: string | null;
	customerId: string | null;
};

const SAMPLE_PATHS = [
	"/dashboard",
	"/dashboard/creator",
	"/dashboard/plans",
	"/dashboard/customers",
];

function revalidateSamplePaths() {
	for (const path of SAMPLE_PATHS) revalidatePath(path);
}

async function readState(creatorId: string): Promise<SampleWorkspaceState> {
	const ids = sampleIds(creatorId);
	const [plan] = await db
		.select({ id: plans.id })
		.from(plans)
		.where(and(eq(plans.id, ids.plan), eq(plans.creatorId, creatorId)))
		.limit(1);
	return {
		loaded: Boolean(plan),
		planId: plan?.id ?? null,
		customerId: plan ? ids.customer : null,
	};
}

export async function getSampleWorkspace() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await readState(session.user.id),
	}));
}

/**
 * Creates a small, fully working workspace so a new creator can see every
 * screen with real data. Rows use deterministic IDs derived from the creator,
 * so they can be removed precisely and never collide with user-created data.
 *
 * This is idempotent: calling it twice returns the existing workspace.
 */
export async function createSampleWorkspace(): Promise<
	ActionResponse<SampleWorkspaceState>
> {
	return authenticatedAction(async (session) => {
		const creatorId = session.user.id;
		const ids = sampleIds(creatorId);

		const data = await db.transaction(async (tx) => {
			await tx
				.insert(plans)
				.values({
					id: ids.plan,
					creatorId,
					name: SAMPLE_PLAN.name,
					description: SAMPLE_PLAN.description,
				})
				.onConflictDoNothing({ target: plans.id });

			// Sample mode simulates an already-published local plan so the demo
			// shows a sellable offer. No Stripe object is provisioned, so this row
			// deliberately has no stripe_* references.
			await tx
				.insert(planVersions)
				.values({
					id: ids.planVersion,
					planId: ids.plan,
					creatorId,
					status: "published",
					billingMode: "one_time",
					currency: SAMPLE_PLAN.currency,
					price: SAMPLE_PLAN.price,
					credits: SAMPLE_PLAN.credits,
					version: 1,
					publishedAt: new Date(),
				})
				.onConflictDoNothing({ target: planVersions.id });

			await tx
				.insert(user)
				.values({
					id: ids.customer,
					name: SAMPLE_CUSTOMER_NAME,
					email: ids.customerEmail,
					emailVerified: true,
				})
				.onConflictDoNothing({ target: user.id });

			// 10 credits bought, 4 already used: the ledger and the balance agree.
			const usedCredits = 4;
			const balance = SAMPLE_PLAN.credits - usedCredits;

			await tx
				.insert(enrollments)
				.values({
					id: ids.enrollment,
					userId: ids.customer,
					planId: ids.plan,
					creatorId,
					credits: balance,
				})
				.onConflictDoNothing({ target: enrollments.id });

			await tx
				.insert(transactions)
				.values([
					{
						id: ids.purchaseTransaction,
						userId: ids.customer,
						creatorId,
						planId: ids.plan,
						planVersionId: ids.planVersion,
						amount: SAMPLE_PLAN.credits,
						amountMoney: SAMPLE_PLAN.price,
						currency: SAMPLE_PLAN.currency,
						type: "purchase",
						status: "completed",
						description: `Sample purchase of ${SAMPLE_PLAN.name}`,
						balanceBefore: 0,
						balanceAfter: SAMPLE_PLAN.credits,
					},
					{
						id: ids.usageTransaction,
						userId: ids.customer,
						creatorId,
						planId: ids.plan,
						amount: -usedCredits,
						type: "usage",
						status: "completed",
						description: "Lesson completed",
						idempotencyKey: `sample-lesson-${ids.enrollment}`,
						balanceBefore: SAMPLE_PLAN.credits,
						balanceAfter: balance,
					},
				])
				.onConflictDoNothing({ target: transactions.id });

			// The demo's credits must be real grants, or the sample would show a
			// balance that not even the sample's own consumption could spend.
			await tx
				.insert(creditGrants)
				.values({
					id: ids.grant,
					enrollmentId: ids.enrollment,
					creatorId,
					userId: ids.customer,
					planId: ids.plan,
					planVersionId: ids.planVersion,
					sourceTransactionId: ids.purchaseTransaction,
					kind: "purchase",
					amount: SAMPLE_PLAN.credits,
					remaining: balance,
				})
				.onConflictDoNothing({ target: creditGrants.id });

			await tx
				.insert(creditAllocations)
				.values({
					id: ids.usageAllocation,
					transactionId: ids.usageTransaction,
					grantId: ids.grant,
					creatorId,
					amount: usedCredits,
				})
				.onConflictDoNothing({
					target: creditAllocations.id,
				});

			await tx
				.insert(invites)
				.values({
					id: ids.invite,
					creatorId,
					email: ids.inviteEmail,
					planId: ids.plan,
					// Random, like any real invite: the sample token must not be guessable.
					token: crypto.randomUUID(),
					status: "pending",
				})
				.onConflictDoNothing({ target: invites.id });

			return {
				loaded: true,
				planId: ids.plan,
				customerId: ids.customer,
			} satisfies SampleWorkspaceState;
		});

		revalidateSamplePaths();
		return { success: true, data };
	});
}

/** Removes only the sample rows, leaving every real plan, customer and ledger intact. */
export async function removeSampleWorkspace(): Promise<
	ActionResponse<SampleWorkspaceState>
> {
	return authenticatedAction(async (session) => {
		const creatorId = session.user.id;
		const ids = sampleIds(creatorId);

		await db.transaction(async (tx) => {
			// Only ledger rows for the sample plan belong to the sample workspace.
			// If the creator enrolled the sample customer in one of their own plans,
			// that traffic must survive.
			await tx
				.delete(transactions)
				.where(
					and(
						eq(transactions.creatorId, creatorId),
						eq(transactions.userId, ids.customer),
						eq(transactions.planId, ids.plan),
					),
				);
			await tx
				.delete(enrollments)
				.where(
					and(
						eq(enrollments.creatorId, creatorId),
						eq(enrollments.id, ids.enrollment),
					),
				);
			await tx
				.delete(invites)
				.where(
					and(eq(invites.creatorId, creatorId), eq(invites.id, ids.invite)),
				);
			await tx
				.delete(planVersions)
				.where(
					and(
						eq(planVersions.creatorId, creatorId),
						eq(planVersions.planId, ids.plan),
					),
				);
			await tx
				.delete(plans)
				.where(and(eq(plans.creatorId, creatorId), eq(plans.id, ids.plan)));
			// The sample customer has no credentials and is never a signed-in account.
			// Remove it only when nothing references it any more.
			await tx.execute(sql`
				delete from "user"
				where id = ${ids.customer}
					and email = ${ids.customerEmail}
					and not exists (
						select 1 from enrollments where user_id = ${ids.customer}
					)
			`);
		});

		revalidateSamplePaths();
		return {
			success: true,
			data: { loaded: false, planId: null, customerId: null },
		};
	});
}
