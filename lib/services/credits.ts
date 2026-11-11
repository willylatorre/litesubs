import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { liteSubscriptions, transactions } from "@/app/db/schema";
import { resolveCustomer } from "./customers";
import { resolvePlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";

export const creditInput = z.object({
	customer: z.string().trim().min(1),
	plan: z.string().trim().min(1),
	amount: z.number().int().min(1).max(1000000),
	reason: z.string().trim().min(1).max(1000),
	idempotency_key: z.string().trim().min(1).max(200).optional(),
	dry_run: z.boolean().default(false),
});

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
		resolvePlan(principal, data.plan),
	]);
	const delta = type === "usage" ? -data.amount : data.amount;
	return adjustCredits(principal, {
		customerId: customer.id,
		planId: plan.id,
		delta,
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
	return db.transaction(async (tx) => {
		if (data.key) {
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
			if (original) {
				if (
					original.userId !== data.customerId ||
					original.productId !== data.planId ||
					original.amount !== data.delta ||
					original.type !== data.type ||
					original.description !== data.reason
				)
					throw new ServiceError(
						"IDEMPOTENCY_CONFLICT",
						"This key was used with different inputs",
						409,
					);
				return {
					transactionId: original.id,
					before: original.balanceBefore,
					after: original.balanceAfter,
					dryRun: false,
					replayed: true,
				};
			}
		}
		const [sub] = await tx
			.select()
			.from(liteSubscriptions)
			.where(
				and(
					eq(liteSubscriptions.creatorId, principal.creatorId),
					eq(liteSubscriptions.userId, data.customerId),
					eq(liteSubscriptions.productId, data.planId),
				),
			)
			.for("update");
		if (!sub) throw new ServiceError("NOT_FOUND", "Enrollment not found", 404);
		const after = sub.credits + data.delta;
		if (after < 0)
			throw new ServiceError(
				"INSUFFICIENT_CREDITS",
				"Not enough credits",
				409,
				{ balance: sub.credits },
			);
		if (after > 2147483647)
			throw new ServiceError(
				"INVALID_INPUT",
				"Balance exceeds supported maximum",
			);
		if (data.dryRun)
			return {
				transactionId: null,
				before: sub.credits,
				after,
				dryRun: true,
				replayed: false,
			};
		await tx
			.update(liteSubscriptions)
			.set({ credits: after })
			.where(eq(liteSubscriptions.id, sub.id));
		const [entry] = await tx
			.insert(transactions)
			.values({
				userId: sub.userId,
				productId: sub.productId,
				creatorId: principal.creatorId,
				amount: data.delta,
				type: data.type,
				status: "completed",
				description: data.reason,
				idempotencyKey: data.key,
				balanceBefore: sub.credits,
				balanceAfter: after,
			})
			.returning({ id: transactions.id });
		return {
			transactionId: entry.id,
			before: sub.credits,
			after,
			dryRun: false,
			replayed: false,
		};
	});
}
