/**
 * Consumption is the operation an external app calls on every unit of usage, so
 * these tests target the failures that cost a creator money: overspending,
 * double spending on retry, spending expired credits, and a debit that silently
 * half-succeeds.
 *
 * Real service and database throughout; no Stripe is involved in consumption.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	creditAllocations,
	creditGrants,
	enrollments,
	plans,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import {
	changeCredits,
	expireGrants,
	usableBalance,
} from "@/lib/services/credits";
import { type Principal, sessionPrincipal } from "@/lib/services/principal";

test("consumption allocates across grants, is retry-safe, and refuses overdrafts", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);
	const machine: Principal = {
		kind: "apiKey",
		creatorId,
		scopes: ["credits:consume"],
	};

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: otherId, name: "Other", email: `${otherId}@example.test` },
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
	]);
	const [plan] = await db
		.insert(plans)
		.values({ creatorId, name: "Lessons" })
		.returning();
	const [version] = await db
		.insert(planVersions)
		.values({
			planId: plan.id,
			creatorId,
			status: "published",
			billingMode: "one_time",
			currency: "usd",
			price: 1000,
			credits: 10,
			version: 1,
			publishedAt: new Date(),
		})
		.returning();

	const grant = async (input: {
		amount: number;
		expiresAt?: Date | null;
		label?: string;
	}) => {
		// Each grant is backed by a real positive ledger row, like a purchase.
		const [entry] = await db
			.insert(transactions)
			.values({
				userId: buyerId,
				creatorId,
				planId: plan.id,
				planVersionId: version.id,
				amount: input.amount,
				type: "purchase",
				status: "completed",
				description: input.label ?? "Pack purchase",
			})
			.returning();
		const [row] = await db
			.insert(creditGrants)
			.values({
				enrollmentId: enrollment.id,
				creatorId,
				userId: buyerId,
				planId: plan.id,
				planVersionId: version.id,
				sourceTransactionId: entry.id,
				kind: "purchase",
				amount: input.amount,
				remaining: input.amount,
				expiresAt: input.expiresAt ?? null,
			})
			.returning();
		await db
			.update(enrollments)
			.set({ credits: await usableBalance(db, enrollment.id) })
			.where(eq(enrollments.id, enrollment.id));
		return row;
	};

	const [enrollment] = await db
		.insert(enrollments)
		.values({ userId: buyerId, planId: plan.id, creatorId, credits: 0 })
		.returning();

	const consume = (amount: number, key: string, dryRun = false) =>
		changeCredits(
			machine,
			{
				customer: buyerId,
				plan: plan.id,
				amount,
				reason: "Lesson completed",
				idempotency_key: key,
				dry_run: dryRun,
			},
			"usage",
		);

	await t.test(
		"a debit spanning two grants allocates from both in order",
		async () => {
			const older = await grant({ amount: 10, label: "First pack" });
			const newer = await grant({ amount: 10, label: "Second pack" });

			// Non-expiring grants spend oldest-first.
			const result = await consume(12, "lesson-1");
			assert.equal(result.before, 20);
			assert.equal(result.after, 8);

			const allocations = await db.query.creditAllocations.findMany({
				where: eq(
					creditAllocations.transactionId,
					result.transactionId as string,
				),
			});
			assert.equal(allocations.length, 2);
			const byGrant = new Map(allocations.map((a) => [a.grantId, a.amount]));
			assert.equal(byGrant.get(older.id), 10, "oldest grant drains first");
			assert.equal(
				byGrant.get(newer.id),
				2,
				"remainder comes from the next grant",
			);

			const remaining = await usableBalance(db, enrollment.id);
			assert.equal(remaining, 8);
		},
	);

	await t.test(
		"an expiring grant is spent before a later non-expiring one",
		async () => {
			// Reset to a clean pair: one expiring soon, one never expiring.
			await db
				.delete(creditAllocations)
				.where(eq(creditAllocations.creatorId, creatorId));
			await db
				.delete(creditGrants)
				.where(eq(creditGrants.creatorId, creatorId));
			const expiring = await grant({
				amount: 3,
				expiresAt: new Date(Date.now() + 60_000),
			});
			const permanent = await grant({ amount: 10 });

			const result = await consume(3, "lesson-expiring");
			const allocations = await db.query.creditAllocations.findMany({
				where: eq(
					creditAllocations.transactionId,
					result.transactionId as string,
				),
			});
			assert.equal(allocations.length, 1);
			assert.equal(allocations[0].grantId, expiring.id);
			assert.equal(allocations[0].amount, 3);
			void permanent;
		},
	);

	await t.test("an overdraft is refused with no partial effects", async () => {
		const before = await usableBalance(db, enrollment.id);
		await assert.rejects(consume(before + 1, "lesson-overdraft"), {
			code: "INSUFFICIENT_CREDITS",
		});
		// Nothing moved: no ledger row, no allocation, no balance change.
		assert.equal(await usableBalance(db, enrollment.id), before);
		const entry = await db.query.transactions.findFirst({
			where: eq(transactions.idempotencyKey, "lesson-overdraft"),
		});
		assert.equal(entry, undefined);
	});

	await t.test("replaying a key returns the original receipt", async () => {
		const original = await consume(2, "lesson-replay");
		const replay = await consume(2, "lesson-replay");
		assert.equal(replay.replayed, true);
		assert.equal(replay.transactionId, original.transactionId);
		assert.equal(replay.before, original.before);
		assert.equal(replay.after, original.after);
		// The second call must not debit again.
		assert.equal(await usableBalance(db, enrollment.id), original.after);
	});

	await t.test(
		"a conflicting payload for the same key is rejected",
		async () => {
			await assert.rejects(consume(5, "lesson-replay"), {
				code: "IDEMPOTENCY_CONFLICT",
			});
		},
	);

	await t.test("concurrent debits cannot overspend", async () => {
		const available = await usableBalance(db, enrollment.id);
		// Ten simultaneous single-unit debits against a smaller balance: only as
		// many as the balance allows may succeed.
		const attempts = Array.from({ length: available + 5 }, (_, index) =>
			consume(1, `lesson-concurrent-${index}`).then(
				() => "ok" as const,
				(error: { code?: string }) =>
					error.code === "INSUFFICIENT_CREDITS"
						? ("rejected" as const)
						: Promise.reject(error),
			),
		);
		const outcomes = await Promise.all(attempts);
		const succeeded = outcomes.filter((o) => o === "ok").length;
		assert.equal(succeeded, available, "every unit is spent exactly once");
		assert.equal(await usableBalance(db, enrollment.id), 0);
	});

	await t.test(
		"an expired grant is not spendable even without a cleanup job",
		async () => {
			await db
				.delete(creditAllocations)
				.where(eq(creditAllocations.creatorId, creatorId));
			await db
				.delete(creditGrants)
				.where(eq(creditGrants.creatorId, creatorId));
			// Already past its boundary; no expiry job has run.
			const stale = await grant({
				amount: 5,
				expiresAt: new Date(Date.now() - 60_000),
			});
			assert.equal(
				await usableBalance(db, enrollment.id),
				0,
				"expired units are excluded on read",
			);
			await assert.rejects(consume(1, "lesson-stale"), {
				code: "INSUFFICIENT_CREDITS",
			});

			// Materializing the expiry is idempotent and records a real ledger row.
			const first = await expireGrants(creatorId);
			assert.equal(first.expiredGrants, 1);
			const second = await expireGrants(creatorId);
			assert.equal(second.expiredGrants, 0);
			const rows = await db
				.select()
				.from(transactions)
				.where(
					and(
						eq(transactions.creatorId, creatorId),
						eq(transactions.type, "expiry"),
					),
				);
			assert.equal(rows.length, 1);
			const reread = await db.query.creditGrants.findFirst({
				where: eq(creditGrants.id, stale.id),
			});
			assert.equal(reread?.remaining, 0);
		},
	);

	await t.test("a dry run reports without consuming or reserving", async () => {
		await db
			.delete(creditAllocations)
			.where(eq(creditAllocations.creatorId, creatorId));
		await db.delete(creditGrants).where(eq(creditGrants.creatorId, creatorId));
		await grant({ amount: 4 });

		const dry = await consume(3, "lesson-dry", true);
		assert.equal(dry.dryRun, true);
		assert.equal(dry.before, 4);
		assert.equal(dry.after, 1);
		assert.equal(await usableBalance(db, enrollment.id), 4, "nothing consumed");

		// A real debit with the same key still works: a dry run reserves nothing.
		const real = await consume(3, "lesson-dry");
		assert.equal(real.replayed, false);
		assert.equal(await usableBalance(db, enrollment.id), 1);
	});

	await t.test("a creator increase becomes a spendable grant", async () => {
		const result = await changeCredits(
			creator,
			{
				customer: buyerId,
				plan: plan.id,
				amount: 6,
				reason: "Support gesture",
			},
			"manual_adjustment",
		);
		assert.equal(result.dryRun, false);
		assert.equal(await usableBalance(db, enrollment.id), 7);
		// And it is spendable through the normal consumption path.
		await consume(7, "lesson-after-grant");
		assert.equal(await usableBalance(db, enrollment.id), 0);
	});

	await t.test("another creator cannot debit this enrollment", async () => {
		const intruder: Principal = {
			kind: "apiKey",
			creatorId: otherId,
			scopes: ["credits:consume"],
		};
		await grant({ amount: 5 });
		await assert.rejects(
			changeCredits(
				intruder,
				{
					customer: buyerId,
					plan: plan.id,
					amount: 1,
					reason: "Not mine",
					idempotency_key: "intruder",
				},
				"usage",
			),
			{ code: "NOT_FOUND" },
		);
	});

	await t.test("consumption requires the credits:consume scope", async () => {
		const readOnly: Principal = {
			kind: "apiKey",
			creatorId,
			scopes: ["plans:read"],
		};
		await assert.rejects(
			changeCredits(
				readOnly,
				{
					customer: buyerId,
					plan: plan.id,
					amount: 1,
					reason: "Nope",
					idempotency_key: "scope-check",
				},
				"usage",
			),
			// An API key is confined to consumption; a key without the permission
			// is refused before any balance is read.
			{ code: "INSUFFICIENT_SCOPE" },
		);
	});

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, otherId));
	await db.delete(user).where(eq(user.id, buyerId));
});
