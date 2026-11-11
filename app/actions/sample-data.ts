"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import {
	invites,
	liteSubscriptions,
	products,
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
	"/dashboard/packs",
	"/dashboard/customers",
];

function revalidateSamplePaths() {
	for (const path of SAMPLE_PATHS) revalidatePath(path);
}

async function readState(creatorId: string): Promise<SampleWorkspaceState> {
	const ids = sampleIds(creatorId);
	const [plan] = await db
		.select({ id: products.id })
		.from(products)
		.where(and(eq(products.id, ids.plan), eq(products.creatorId, creatorId)))
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
				.insert(products)
				.values({
					id: ids.plan,
					creatorId,
					name: SAMPLE_PLAN.name,
					description: SAMPLE_PLAN.description,
					price: SAMPLE_PLAN.price,
					credits: SAMPLE_PLAN.credits,
					currency: SAMPLE_PLAN.currency,
					type: "one_time",
					active: true,
				})
				.onConflictDoNothing({ target: products.id });

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
				.insert(liteSubscriptions)
				.values({
					id: ids.enrollment,
					userId: ids.customer,
					productId: ids.plan,
					creatorId,
					credits: balance,
				})
				.onConflictDoNothing({ target: liteSubscriptions.id });

			await tx
				.insert(transactions)
				.values([
					{
						id: ids.purchaseTransaction,
						userId: ids.customer,
						creatorId,
						productId: ids.plan,
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
						productId: ids.plan,
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

			await tx
				.insert(invites)
				.values({
					id: ids.invite,
					creatorId,
					email: ids.inviteEmail,
					productId: ids.plan,
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
						eq(transactions.productId, ids.plan),
					),
				);
			await tx
				.delete(liteSubscriptions)
				.where(
					and(
						eq(liteSubscriptions.creatorId, creatorId),
						eq(liteSubscriptions.id, ids.enrollment),
					),
				);
			await tx
				.delete(invites)
				.where(
					and(eq(invites.creatorId, creatorId), eq(invites.id, ids.invite)),
				);
			await tx
				.delete(products)
				.where(
					and(eq(products.creatorId, creatorId), eq(products.id, ids.plan)),
				);
			// The sample customer has no credentials and is never a signed-in account.
			// Remove it only when nothing references it any more.
			await tx.execute(sql`
				delete from "user"
				where id = ${ids.customer}
					and email = ${ids.customerEmail}
					and not exists (
						select 1 from lite_subscriptions where user_id = ${ids.customer}
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
