import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import {
	creditAllocations,
	creditGrants,
	enrollments,
	transactions,
} from "@/app/db/schema";
import { resolveCustomer } from "./customers";
import { resolvePublishedPlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";

/**
 * The credit ledger: the only code allowed to change a balance.
 *
 * Credits are tracked as **grants** (purchases, comps, adjustments) that hold
 * their own remaining amount and expiry, rather than one undifferentiated
 * enrollment counter. That buys three things this slice needs:
 *
 * - Spending is attributable: each debit records which grants it consumed.
 * - Expiry is enforceable on read. A grant past its boundary is simply not
 *   usable, so no scheduled job has to run for correctness.
 * - Monthly periods can later grant and expire allowances without a second
 *   balance concept.
 *
 * The enrollment `credits` column is a projection of the usable grants and is
 * updated in the same transaction. It is never the source of truth for what may
 * be spent.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const creditInput = z.object({
	customer: z.string().trim().min(1),
	plan: z.string().trim().min(1),
	amount: z.number().int().min(1).max(1000000),
	reason: z.string().trim().min(1).max(1000),
	idempotency_key: z.string().trim().min(1).max(200).optional(),
	dry_run: z.boolean().default(false),
});

export type GrantKind = "purchase" | "comp" | "adjustment" | "period";

export type AllocationView = {
	grantId: string;
	amount: number;
	expiresAt: string | null;
};

/**
 * Deterministic spend order, stated once so every caller agrees:
 *
 * 1. grants with an expiry, soonest expiry first;
 * 2. then grants without an expiry, oldest first.
 *
 * Burning the credit that is about to disappear protects the customer's value.
 */
function spendOrder() {
	return [
		// Non-expiring grants sort last regardless of age.
		sql`${creditGrants.expiresAt} nulls last`,
		asc(creditGrants.expiresAt),
		asc(creditGrants.createdAt),
		asc(creditGrants.id),
	];
}

function usableGrantFilter() {
	return and(
		gt(creditGrants.remaining, 0),
		or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, new Date())),
	);
}

/** Sum of spendable units right now, ignoring expired leftovers. */
export async function usableBalance(
	client: Pick<typeof db, "select">,
	enrollmentId: string,
) {
	const [row] = await client
		.select({
			total: sql<number>`coalesce(sum(${creditGrants.remaining}), 0)::int`,
		})
		.from(creditGrants)
		.where(
			and(eq(creditGrants.enrollmentId, enrollmentId), usableGrantFilter()),
		);
	return row?.total ?? 0;
}

/**
 * Record a positive credit movement as a grant.
 *
 * Every balance increase goes through here so no path can create credits that
 * are unattributable or unexpirable.
 */
export async function createGrant(
	tx: Tx,
	input: {
		enrollmentId: string;
		creatorId: string;
		userId: string;
		planId: string;
		planVersionId?: string | null;
		sourceTransactionId?: string | null;
		kind: GrantKind;
		amount: number;
		expiresAt?: Date | null;
	},
) {
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
		throw new ServiceError("INVALID_INPUT", "A grant must be positive");
	const [grant] = await tx
		.insert(creditGrants)
		.values({
			enrollmentId: input.enrollmentId,
			creatorId: input.creatorId,
			userId: input.userId,
			planId: input.planId,
			planVersionId: input.planVersionId ?? null,
			sourceTransactionId: input.sourceTransactionId ?? null,
			kind: input.kind,
			amount: input.amount,
			remaining: input.amount,
			expiresAt: input.expiresAt ?? null,
		})
		.returning();
	return grant;
}

/**
 * Apply a positive delta by creating a grant and raising the projection.
 * Used by comps, creator increases, and purchase fulfillment.
 */
export async function grantCredits(
	tx: Tx,
	input: {
		enrollmentId: string;
		creatorId: string;
		userId: string;
		planId: string;
		planVersionId?: string | null;
		sourceTransactionId?: string | null;
		kind: GrantKind;
		amount: number;
		expiresAt?: Date | null;
	},
) {
	const grant = await createGrant(tx, input);
	await tx
		.update(enrollments)
		.set({ credits: sql`${enrollments.credits} + ${input.amount}` })
		.where(eq(enrollments.id, input.enrollmentId));
	return grant;
}

/**
 * Split a debit across usable grants in the documented order.
 *
 * All-or-nothing: if the grants cannot cover the whole amount, nothing is
 * allocated and the caller gets INSUFFICIENT_CREDITS. Partial spending would
 * leave a caller believing a debit succeeded while half of it did not.
 */
export async function allocateDebit(
	tx: Tx,
	input: {
		enrollmentId: string;
		creatorId: string;
		amount: number;
		transactionId: string;
	},
) {
	// Lock the grants this debit may consume so concurrent debits serialize
	// instead of both reading the same `remaining`.
	const grants = await tx
		.select()
		.from(creditGrants)
		.where(
			and(
				eq(creditGrants.enrollmentId, input.enrollmentId),
				usableGrantFilter(),
			),
		)
		.orderBy(...spendOrder())
		.for("update");

	const available = grants.reduce((sum, grant) => sum + grant.remaining, 0);
	if (available < input.amount)
		throw new ServiceError("INSUFFICIENT_CREDITS", "Not enough credits", 409, {
			balance: available,
		});

	const allocations: { grantId: string; amount: number }[] = [];
	let outstanding = input.amount;
	for (const grant of grants) {
		if (outstanding === 0) break;
		const take = Math.min(grant.remaining, outstanding);
		if (take <= 0) continue;
		await tx
			.update(creditGrants)
			.set({ remaining: sql`${creditGrants.remaining} - ${take}` })
			.where(eq(creditGrants.id, grant.id));
		allocations.push({ grantId: grant.id, amount: take });
		outstanding -= take;
	}
	if (outstanding !== 0)
		// Unreachable while `available` is computed from the locked rows; kept as
		// a hard stop so a future edit cannot silently under-allocate.
		throw new ServiceError("INSUFFICIENT_CREDITS", "Not enough credits", 409, {
			balance: available,
		});

	await tx.insert(creditAllocations).values(
		allocations.map((allocation) => ({
			transactionId: input.transactionId,
			grantId: allocation.grantId,
			creatorId: input.creatorId,
			amount: allocation.amount,
		})),
	);
	return allocations;
}

/** Lower the projection without touching grants (used with an allocation). */
async function applyProjection(tx: Tx, enrollmentId: string, delta: number) {
	const [updated] = await tx
		.update(enrollments)
		.set({ credits: sql`${enrollments.credits} + ${delta}` })
		.where(
			and(
				eq(enrollments.id, enrollmentId),
				sql`${enrollments.credits} + ${delta} >= 0`,
			),
		)
		.returning();
	return updated;
}

export async function changeCredits(
	principal: Principal,
	input: unknown,
	type: "manual_adjustment" | "usage",
) {
	requireScope(
		principal,
		type === "usage" ? "credits:consume" : "customers:write",
	);
	const data = creditInput.parse(input);
	if (type === "usage" && !data.idempotency_key)
		throw new ServiceError(
			"IDEMPOTENCY_REQUIRED",
			"Consumption requires a stable idempotency_key",
		);
	const [customer, plan] = await Promise.all([
		resolveCustomer(principal, data.customer),
		// Credit mutations target an enrollment, so they need sellable terms:
		// a draft plan has nothing to enroll against yet.
		resolvePublishedPlan(principal.creatorId, data.plan),
	]);
	return adjustCredits(principal, {
		customerId: customer.id,
		planId: plan.plan.id,
		delta: type === "usage" ? -data.amount : data.amount,
		type,
		reason: data.reason,
		key: data.idempotency_key,
		dryRun: data.dry_run,
	});
}

// Row locking serializes concurrent debits. Advisory locking serializes a
// creator/key pair even when callers target different enrollments with it.
export async function adjustCredits(
	principal: Principal,
	data: {
		customerId: string;
		planId: string;
		delta: number;
		type: "manual_adjustment" | "usage";
		reason: string;
		key?: string;
		dryRun?: boolean;
	},
) {
	requireScope(
		principal,
		data.type === "usage" ? "credits:consume" : "customers:write",
	);
	if (
		!Number.isSafeInteger(data.delta) ||
		data.delta === 0 ||
		!data.reason.trim()
	)
		throw new ServiceError(
			"INVALID_INPUT",
			"An integer credit change and reason are required",
		);
	if (data.type === "usage" && (data.delta > 0 || !data.key?.trim()))
		throw new ServiceError(
			"IDEMPOTENCY_REQUIRED",
			"Usage requires a debit and stable idempotency key",
		);

	const replay = async (tx: Tx) => {
		if (!data.key) return null;
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([principal.creatorId, data.key])}, 0))`,
		);
		const [original] = await tx
			.select()
			.from(transactions)
			.where(
				and(
					eq(transactions.creatorId, principal.creatorId),
					eq(transactions.idempotencyKey, data.key),
				),
			);
		if (!original) return null;
		if (
			original.userId !== data.customerId ||
			original.planId !== data.planId ||
			original.amount !== data.delta ||
			original.type !== data.type ||
			original.description !== data.reason
		)
			throw new ServiceError(
				"IDEMPOTENCY_CONFLICT",
				"This key was used with different inputs",
				409,
			);
		const allocations = await tx
			.select({
				grantId: creditAllocations.grantId,
				amount: creditAllocations.amount,
			})
			.from(creditAllocations)
			.where(eq(creditAllocations.transactionId, original.id));
		return {
			transactionId: original.id,
			before: original.balanceBefore,
			after: original.balanceAfter,
			dryRun: false,
			replayed: true,
			allocations,
		};
	};

	return db.transaction(async (tx) => {
		const original = await replay(tx);
		if (original) return original;

		const [enrollment] = await tx
			.select()
			.from(enrollments)
			.where(
				and(
					eq(enrollments.creatorId, principal.creatorId),
					eq(enrollments.userId, data.customerId),
					eq(enrollments.planId, data.planId),
				),
			)
			.for("update");
		if (!enrollment)
			throw new ServiceError("NOT_FOUND", "Enrollment not found", 404);

		// The projection is derived, not trusted: expired grants must not be
		// spendable just because a cleanup job has not rewritten the counter.
		const before = await usableBalance(tx, enrollment.id);

		if (data.delta > 0) {
			const after = before + data.delta;
			if (after > 2147483647)
				throw new ServiceError(
					"INVALID_INPUT",
					"Balance exceeds supported maximum",
				);
			if (data.dryRun)
				return {
					transactionId: null,
					before,
					after,
					dryRun: true,
					replayed: false,
					allocations: [],
				};
			// Negative adjustments larger than the projection are already covered
			// by the debit path; a positive one needs no allocation.
			const [entry] = await tx
				.insert(transactions)
				.values({
					userId: enrollment.userId,
					planId: enrollment.planId,
					creatorId: principal.creatorId,
					amount: data.delta,
					type: data.type,
					status: "completed",
					description: data.reason,
					idempotencyKey: data.key,
					balanceBefore: before,
					balanceAfter: after,
				})
				.returning({ id: transactions.id });
			await grantCredits(tx, {
				enrollmentId: enrollment.id,
				creatorId: principal.creatorId,
				userId: enrollment.userId,
				planId: enrollment.planId,
				sourceTransactionId: entry.id,
				kind: data.type === "usage" ? "adjustment" : "adjustment",
				amount: data.delta,
			});
			return {
				transactionId: entry.id,
				before,
				after,
				dryRun: false,
				replayed: false,
				allocations: [],
			};
		}

		const debit = Math.abs(data.delta);
		if (data.dryRun) {
			// Report what a real debit would do without reserving or consuming.
			if (before < debit)
				throw new ServiceError(
					"INSUFFICIENT_CREDITS",
					"Not enough credits",
					409,
					{ balance: before },
				);
			return {
				transactionId: null,
				before,
				after: before - debit,
				dryRun: true,
				replayed: false,
				allocations: [],
			};
		}

		// Insert the ledger row first so allocations can reference it, then
		// allocate. Both happen in this transaction, so a failure rolls back the
		// row as well and no partial debit is ever visible.
		const [entry] = await tx
			.insert(transactions)
			.values({
				userId: enrollment.userId,
				planId: enrollment.planId,
				creatorId: principal.creatorId,
				amount: data.delta,
				type: data.type,
				status: "completed",
				description: data.reason,
				idempotencyKey: data.key,
				balanceBefore: before,
				balanceAfter: before - debit,
			})
			.returning({ id: transactions.id });

		const allocations = await allocateDebit(tx, {
			enrollmentId: enrollment.id,
			creatorId: principal.creatorId,
			amount: debit,
			transactionId: entry.id,
		});
		const updated = await applyProjection(tx, enrollment.id, -debit);
		if (!updated)
			throw new ServiceError(
				"INSUFFICIENT_CREDITS",
				"Not enough credits",
				409,
				{ balance: before },
			);

		return {
			transactionId: entry.id,
			before,
			after: before - debit,
			dryRun: false,
			replayed: false,
			allocations,
		};
	});
}

/**
 * Materialize grants that have passed their boundary as expired ledger rows.
 *
 * Not required for correctness — `usableBalance` and allocation already ignore
 * them — but it makes history legible and is safe to run repeatedly.
 */
export async function expireGrants(creatorId: string) {
	return db.transaction(async (tx) => {
		const expired = await tx
			.select()
			.from(creditGrants)
			.where(
				and(
					eq(creditGrants.creatorId, creatorId),
					gt(creditGrants.remaining, 0),
					// Only expired ones still holding units need recording.
					sql`${creditGrants.expiresAt} is not null and ${creditGrants.expiresAt} <= now()`,
				),
			)
			.for("update");
		let recorded = 0;
		for (const grant of expired) {
			const [entry] = await tx
				.insert(transactions)
				.values({
					userId: grant.userId,
					planId: grant.planId,
					creatorId: grant.creatorId,
					planVersionId: grant.planVersionId,
					amount: 0,
					type: "expiry",
					status: "completed",
					description: `${grant.remaining} credit(s) expired`,
					idempotencyKey: `expiry:${grant.id}`,
					balanceBefore: 0,
					balanceAfter: 0,
				})
				.onConflictDoNothing()
				.returning({ id: transactions.id });
			if (!entry) continue;
			await tx
				.update(creditGrants)
				.set({ remaining: 0 })
				.where(eq(creditGrants.id, grant.id));
			await tx.insert(creditAllocations).values({
				transactionId: entry.id,
				grantId: grant.id,
				creatorId: grant.creatorId,
				amount: grant.remaining,
			});
			recorded += 1;
		}
		return { expiredGrants: recorded };
	});
}
