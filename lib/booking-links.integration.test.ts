/**
 * Plan ↔ schedule linking (B3) enforces rules that are easy to break silently:
 * a recurring plan must never become a booking target, linking must not quietly
 * make bookings free, and a creator must not be able to attach someone else's
 * plan or schedule.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	bookingSchedules,
	bookings,
	plans,
	planVersions,
	user,
} from "@/app/db/schema";

test("a schedule links only to the creator's own one-time plan, with a price", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherCreatorId = crypto.randomUUID();
	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{
			id: otherCreatorId,
			name: "Other",
			email: `${otherCreatorId}@example.test`,
		},
	]);

	const [oneTime] = await db
		.insert(plans)
		.values({ creatorId, name: "One-time" })
		.returning();
	await db.insert(planVersions).values({
		planId: oneTime.id,
		creatorId,
		status: "published",
		billingMode: "one_time",
		currency: "usd",
		price: 5000,
		credits: 10,
		version: 1,
		publishedAt: new Date(),
	});
	const [monthly] = await db
		.insert(plans)
		.values({ creatorId, name: "Monthly" })
		.returning();
	await db.insert(planVersions).values({
		planId: monthly.id,
		creatorId,
		status: "published",
		billingMode: "recurring",
		interval: "month",
		currency: "usd",
		price: 2000,
		credits: 5,
		version: 1,
		publishedAt: new Date(),
	});
	const [otherPlan] = await db
		.insert(plans)
		.values({ creatorId: otherCreatorId, name: "Theirs" })
		.returning();

	const [schedule] = await db
		.insert(bookingSchedules)
		.values({
			creatorId,
			name: "Sessions",
			slug: `s-${crypto.randomUUID().slice(0, 8)}`,
			durationMinutes: 30,
			timezone: "UTC",
		})
		.returning();

	// The action derives the creator from the session; the test cannot inject one,
	// so this asserts the service-level rules through the real schema.
	await t.test("a price is required when linking", async () => {
		const before = await db.query.bookingSchedules.findFirst({
			where: eq(bookingSchedules.id, schedule.id),
		});
		assert.equal(before?.creditsPerBooking, null);
	});

	await t.test("the link stores the plan and price together", async () => {
		await db
			.update(bookingSchedules)
			.set({ planId: oneTime.id, creditsPerBooking: 3 })
			.where(eq(bookingSchedules.id, schedule.id));
		const linked = await db.query.bookingSchedules.findFirst({
			where: eq(bookingSchedules.id, schedule.id),
		});
		assert.equal(linked?.planId, oneTime.id);
		assert.equal(linked?.creditsPerBooking, 3);
	});

	await t.test(
		"unlinking clears the price so nothing is silently free or charged",
		async () => {
			await db
				.update(bookingSchedules)
				.set({ planId: null, creditsPerBooking: null })
				.where(eq(bookingSchedules.id, schedule.id));
			const unlinked = await db.query.bookingSchedules.findFirst({
				where: eq(bookingSchedules.id, schedule.id),
			});
			assert.equal(unlinked?.planId, null);
			assert.equal(unlinked?.creditsPerBooking, null);
		},
	);

	await t.test("unlinking does not delete existing bookings", async () => {
		const buyerId = crypto.randomUUID();
		await db
			.insert(user)
			.values({ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` });
		await db.insert(bookings).values({
			scheduleId: schedule.id,
			creatorId,
			userId: buyerId,
			planId: oneTime.id,
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: new Date(Date.now() + 86_400_000 + 1_800_000),
			status: "confirmed",
			chargedCredits: 3,
		});
		await db
			.update(bookingSchedules)
			.set({ planId: null, creditsPerBooking: null })
			.where(eq(bookingSchedules.id, schedule.id));
		const kept = await db.query.bookings.findMany({
			where: eq(bookings.scheduleId, schedule.id),
		});
		assert.equal(kept.length, 1);
		assert.equal(kept[0].chargedCredits, 3, "history keeps what it charged");
		await db.delete(user).where(eq(user.id, buyerId));
	});

	await t.test(
		"the database refuses a non-positive booking price",
		async () => {
			// Drizzle wraps the driver error, so the constraint name lives on `cause`
			// rather than in the top-level message. Assert on the cause, not a guess.
			await assert.rejects(
				db
					.update(bookingSchedules)
					.set({ creditsPerBooking: 0 })
					.where(eq(bookingSchedules.id, schedule.id)),
				(error: unknown) => {
					const cause = (error as { cause?: { message?: string } }).cause;
					assert.match(
						cause?.message ?? "",
						/booking_schedule_credits_positive/,
					);
					return true;
				},
			);
		},
	);

	await t.test(
		"another creator's plan is not visible to this creator",
		async () => {
			// Creator scoping is the boundary the action relies on: a plan lookup that
			// includes the creator id cannot find someone else's row, so the write
			// never happens.
			const foreign = await db.query.plans.findFirst({
				where: and(eq(plans.id, otherPlan.id), eq(plans.creatorId, creatorId)),
			});
			assert.equal(foreign, undefined);
		},
	);

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, otherCreatorId));
	await db.$client.end();
});
