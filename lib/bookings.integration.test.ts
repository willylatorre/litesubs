/**
 * A booking spends real customer credits, so these cases target what would cost
 * money or trust: charging twice for one slot, charging a plan the customer did
 * not pick, inventing credits on cancellation, and leaving a confirmed booking
 * behind when the debit was refused.
 *
 * The slot math and the credit ledger are tested on their own elsewhere; this
 * covers the seam between them, which is the transaction that must not
 * half-succeed.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	bookingAvailability,
	bookingSchedules,
	bookings,
	creditGrants,
	enrollments,
	plans,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import { usableBalance } from "@/lib/services/credits";
import { sessionPrincipal } from "@/lib/services/principal";
import {
	createBooking,
	cancelBooking,
	listOpenSlots,
} from "@/lib/services/bookings";

async function seedCredits(input: {
	creatorId: string;
	userId: string;
	planId: string;
	amount: number;
}) {
	const [enrollment] = await db
		.insert(enrollments)
		.values({
			userId: input.userId,
			planId: input.planId,
			creatorId: input.creatorId,
			credits: 0,
		})
		.returning();
	const [grant] = await db
		.insert(creditGrants)
		.values({
			enrollmentId: enrollment.id,
			creatorId: input.creatorId,
			userId: input.userId,
			planId: input.planId,
			kind: "purchase",
			amount: input.amount,
			remaining: input.amount,
		})
		.returning();
	await db
		.update(enrollments)
		.set({ credits: input.amount })
		.where(eq(enrollments.id, enrollment.id));
	return { enrollment, grant };
}

test("a booking spends its own plan's credits once and cancellation returns them", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherCreatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const outsiderId = crypto.randomUUID();

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{
			id: otherCreatorId,
			name: "Other creator",
			email: `${otherCreatorId}@example.test`,
		},
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
		{ id: outsiderId, name: "Outsider", email: `${outsiderId}@example.test` },
	]);

	const [plan] = await db
		.insert(plans)
		.values({ creatorId, name: "Coaching" })
		.returning();
	await db.insert(planVersions).values({
		planId: plan.id,
		creatorId,
		status: "published",
		billingMode: "one_time",
		currency: "usd",
		price: 10_000,
		credits: 10,
		version: 1,
		publishedAt: new Date(),
	});

	// A schedule open 09:00-11:00 UTC tomorrow, priced at 3 credits.
	const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
	const dayStart = new Date(
		Date.UTC(
			tomorrow.getUTCFullYear(),
			tomorrow.getUTCMonth(),
			tomorrow.getUTCDate(),
			0,
		),
	);
	const weekday = dayStart.getUTCDay();
	const [schedule] = await db
		.insert(bookingSchedules)
		.values({
			creatorId,
			name: "Sessions",
			slug: `sessions-${crypto.randomUUID().slice(0, 8)}`,
			planId: plan.id,
			creditsPerBooking: 3,
			durationMinutes: 30,
			horizonDays: 3,
			timezone: "UTC",
		})
		.returning();
	await db.insert(bookingAvailability).values({
		scheduleId: schedule.id,
		creatorId,
		weekday,
		startMinute: 9 * 60,
		endMinute: 11 * 60,
	});

	const { enrollment } = await seedCredits({
		creatorId,
		userId: buyerId,
		planId: plan.id,
		amount: 10,
	});
	assert.equal(await usableBalance(db, enrollment.id), 10);

	const buyer = { ...sessionPrincipal(buyerId), creatorId: buyerId };
	const firstSlot = new Date(dayStart.getTime() + 9 * 60 * 60 * 1000);

	await t.test("the booking spends exactly the schedule's price", async () => {
		const created = await createBooking(buyer, {
			scheduleId: schedule.id,
			startsAt: firstSlot.toISOString(),
		});
		assert.equal(created.chargedCredits, 3);
		assert.equal(created.balance, 7);
		assert.equal(await usableBalance(db, enrollment.id), 7);

		const row = await db.query.bookings.findFirst({
			where: eq(bookings.id, created.bookingId),
		});
		assert.equal(row?.status, "confirmed");
		assert.equal(row?.userId, buyerId);
		assert.equal(row?.creatorId, creatorId);
		assert.equal(row?.chargedCredits, 3);
		assert.ok(row?.chargeTransactionId);

		const ledger = await db.query.transactions.findFirst({
			where: eq(transactions.id, row?.chargeTransactionId as string),
		});
		assert.equal(ledger?.amount, -3);
		assert.equal(ledger?.type, "usage");
		assert.equal(ledger?.userId, buyerId);
	});

	await t.test("the booked slot disappears from the open slots", async () => {
		const open = await listOpenSlots(schedule.slug);
		assert.ok(open.schedule);
		assert.equal(
			open.slots.some((slot) => slot.start === firstSlot.toISOString()),
			false,
			"a confirmed booking is no longer offered",
		);
	});

	await t.test("the same slot cannot be booked twice", async () => {
		await assert.rejects(
			createBooking(buyer, {
				scheduleId: schedule.id,
				startsAt: firstSlot.toISOString(),
			}),
			{ code: "SLOT_UNAVAILABLE" },
		);
		// The refused attempt must not have charged anything.
		assert.equal(await usableBalance(db, enrollment.id), 7);
	});

	await t.test("a slot the page never offered is refused", async () => {
		await assert.rejects(
			createBooking(buyer, {
				scheduleId: schedule.id,
				// 12:00 is outside the 09:00-11:00 window.
				startsAt: new Date(
					dayStart.getTime() + 12 * 60 * 60 * 1000,
				).toISOString(),
			}),
			{ code: "SLOT_UNAVAILABLE" },
		);
		assert.equal(await usableBalance(db, enrollment.id), 7);
	});

	await t.test(
		"cancelling returns exactly what the booking spent, once",
		async () => {
			const booking = await db.query.bookings.findFirst({
				where: eq(bookings.planId, plan.id),
			});
			const result = await cancelBooking(buyer, {
				bookingId: booking?.id as string,
				reason: "Changed plans",
			});
			assert.equal(result.status, "cancelled");
			if (result.status !== "cancelled") return;
			assert.equal(result.restored, 3);
			assert.equal(await usableBalance(db, enrollment.id), 10);

			// A second cancel must not mint more credits.
			const again = await cancelBooking(buyer, {
				bookingId: booking?.id as string,
			});
			assert.equal(again.status, "already_cancelled");
			assert.equal(await usableBalance(db, enrollment.id), 10);

			const grants = await db.query.creditGrants.findMany({
				where: eq(creditGrants.enrollmentId, enrollment.id),
			});
			assert.ok(
				grants.every((grant) => grant.remaining <= grant.amount),
				"a restore never inflates a grant past its original size",
			);
		},
	);

	await t.test("the freed slot is bookable again", async () => {
		const again = await createBooking(buyer, {
			scheduleId: schedule.id,
			startsAt: firstSlot.toISOString(),
		});
		assert.equal(again.chargedCredits, 3);
		assert.equal(await usableBalance(db, enrollment.id), 7);
	});

	await t.test("a customer without the plan cannot book", async () => {
		const outsider = { ...sessionPrincipal(outsiderId), creatorId: outsiderId };
		await assert.rejects(
			createBooking(outsider, {
				scheduleId: schedule.id,
				startsAt: new Date(
					dayStart.getTime() + 10 * 60 * 60 * 1000,
				).toISOString(),
			}),
			{ code: "NOT_ENROLLED" },
		);
	});

	await t.test(
		"another user cannot cancel someone else's booking",
		async () => {
			const booking = await db.query.bookings.findFirst({
				where: and(
					eq(bookings.planId, plan.id),
					eq(bookings.status, "confirmed"),
				),
			});
			const outsider = {
				...sessionPrincipal(outsiderId),
				creatorId: outsiderId,
			};
			await assert.rejects(
				cancelBooking(outsider, { bookingId: booking?.id as string }),
				{ code: "NOT_FOUND" },
			);
		},
	);

	await t.test("a schedule without a linked plan is not bookable", async () => {
		const [bare] = await db
			.insert(bookingSchedules)
			.values({
				creatorId,
				name: "No plan",
				slug: `bare-${crypto.randomUUID().slice(0, 8)}`,
				durationMinutes: 30,
				horizonDays: 3,
				timezone: "UTC",
			})
			.returning();
		await db.insert(bookingAvailability).values({
			scheduleId: bare.id,
			creatorId,
			weekday,
			startMinute: 9 * 60,
			endMinute: 11 * 60,
		});
		await assert.rejects(
			createBooking(buyer, {
				scheduleId: bare.id,
				startsAt: new Date(
					dayStart.getTime() + 9 * 60 * 60 * 1000,
				).toISOString(),
			}),
			{ code: "NOT_BOOKABLE" },
		);
	});

	await t.test("a monthly plan cannot be a booking target", async () => {
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
		const [monthlySchedule] = await db
			.insert(bookingSchedules)
			.values({
				creatorId,
				name: "Monthly sessions",
				slug: `monthly-${crypto.randomUUID().slice(0, 8)}`,
				planId: monthly.id,
				creditsPerBooking: 1,
				durationMinutes: 30,
				horizonDays: 3,
				timezone: "UTC",
			})
			.returning();
		await db.insert(bookingAvailability).values({
			scheduleId: monthlySchedule.id,
			creatorId,
			weekday,
			startMinute: 9 * 60,
			endMinute: 11 * 60,
		});
		await db.insert(enrollments).values({
			userId: buyerId,
			planId: monthly.id,
			creatorId,
			credits: 5,
		});
		await assert.rejects(
			createBooking(buyer, {
				scheduleId: monthlySchedule.id,
				startsAt: new Date(
					dayStart.getTime() + 9 * 60 * 60 * 1000,
				).toISOString(),
			}),
			{ code: "NOT_BOOKABLE" },
		);
	});

	await t.test("a creator cannot book their own schedule", async () => {
		const owner = sessionPrincipal(creatorId);
		await assert.rejects(
			createBooking(owner, {
				scheduleId: schedule.id,
				startsAt: new Date(
					dayStart.getTime() + 10 * 60 * 60 * 1000,
				).toISOString(),
			}),
			{ code: "INVALID_INPUT" },
		);
	});

	for (const id of [creatorId, otherCreatorId, buyerId, outsiderId])
		await db.delete(user).where(eq(user.id, id));
	await db.$client.end();
});
