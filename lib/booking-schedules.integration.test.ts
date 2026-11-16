/**
 * A creator's availability defines what other people can book, so these tests
 * target the failures that would be visible to a customer: another creator
 * reaching the schedule, a window that cannot be interpreted, and a stored set
 * that does not read back as it was saved.
 *
 * Real service and database throughout. Opt-in: set MCP_TEST_DATABASE_URL to a
 * disposable PostgreSQL database (and the same value as DATABASE_URL).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	bookingAvailability,
	bookingSchedules,
	bookings,
	user,
} from "@/app/db/schema";
import {
	createSchedule,
	exceptionsSchema,
	getSchedule,
	listSchedules,
	replaceAvailability,
	replaceExceptions,
	updateSchedule,
} from "@/lib/services/booking-schedules";
import { isSampleScheduleId, SAMPLE_SCHEDULE } from "@/lib/sample-data";
import {
	removeSampleSchedule,
	seedSampleSchedule,
} from "@/lib/sample-schedule";
import { ServiceError, sessionPrincipal } from "@/lib/services/principal";

/** Assert that `run` refuses with a ServiceError carrying `code`. */
async function assertRefused(
	run: () => Promise<unknown>,
	code: string,
	messagePart?: string,
) {
	try {
		await run();
	} catch (error) {
		assert.ok(
			error instanceof ServiceError,
			`expected ServiceError, got ${error instanceof Error ? error.name : typeof error}`,
		);
		assert.equal(error.code, code);
		if (messagePart)
			assert.ok(
				error.message.includes(messagePart),
				`expected message to include ${JSON.stringify(messagePart)}, got ${JSON.stringify(error.message)}`,
			);
		return error;
	}
	assert.fail(`expected ${code}, but the call succeeded`);
}

const settings = {
	name: "Office hours",
	slug: "office-hours",
	description: "A sample of the bookable week",
	durationMinutes: 30,
	bufferBeforeMinutes: 5,
	bufferAfterMinutes: 10,
	horizonDays: 45,
	timezone: "America/New_York",
	active: true,
};

test("availability is creator-scoped, validated, and round-trips exactly", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);

	const creatorA = crypto.randomUUID();
	const creatorB = crypto.randomUUID();
	const principalA = sessionPrincipal(creatorA);
	const principalB = sessionPrincipal(creatorB);

	await db.insert(user).values([
		{ id: creatorA, name: "Creator A", email: `${creatorA}@example.test` },
		{ id: creatorB, name: "Creator B", email: `${creatorB}@example.test` },
	]);
	t.after(async () => {
		// Schedules cascade to availability and exceptions through their FK.
		await db
			.delete(bookingSchedules)
			.where(eq(bookingSchedules.creatorId, creatorA));
		await db
			.delete(bookingSchedules)
			.where(eq(bookingSchedules.creatorId, creatorB));
		await db.delete(user).where(eq(user.id, creatorA));
		await db.delete(user).where(eq(user.id, creatorB));
	});

	const schedule = await createSchedule(principalA, settings);

	await t.test("a valid window set round-trips exactly", async () => {
		const windows = [
			{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
			{ weekday: 1, startMinute: 13 * 60, endMinute: 17 * 60 },
			{ weekday: 3, startMinute: 0, endMinute: 1440 },
		];
		const saved = await replaceAvailability(principalA, schedule.id, windows);

		assert.deepEqual(
			saved.availability.map((row) => ({
				weekday: row.weekday,
				startMinute: row.startMinute,
				endMinute: row.endMinute,
			})),
			windows,
		);

		// The read path must agree with the write path, not just the return value.
		const reread = await getSchedule(principalA, schedule.slug);
		assert.deepEqual(
			reread.availability.map((row) => ({
				weekday: row.weekday,
				startMinute: row.startMinute,
				endMinute: row.endMinute,
			})),
			windows,
		);

		const rows = await db
			.select()
			.from(bookingAvailability)
			.where(
				and(
					eq(bookingAvailability.scheduleId, schedule.id),
					eq(bookingAvailability.creatorId, creatorA),
				),
			);
		assert.equal(rows.length, 3);
		assert.ok(rows.every((row) => row.creatorId === creatorA));
	});

	await t.test("an empty set clears availability", async () => {
		const cleared = await replaceAvailability(principalA, schedule.id, []);
		assert.equal(cleared.availability.length, 0);
	});

	await t.test("nonexistent IANA timezone is refused", async () => {
		await assertRefused(
			() =>
				updateSchedule(principalA, schedule.id, {
					timezone: "Mars/Olympus_Mons",
				}),
			"INVALID_INPUT",
			"IANA timezone",
		);

		// A bare UTC offset is syntactically accepted by Intl but carries no DST
		// rules, so it must be refused as well.
		await assertRefused(
			() => updateSchedule(principalA, schedule.id, { timezone: "+05:00" }),
			"INVALID_INPUT",
		);

		// The schedule is untouched by a refused write.
		const current = await getSchedule(principalA, schedule.id);
		assert.equal(current.timezone, settings.timezone);
	});

	await t.test("bad duration, buffers, and horizon are refused", async () => {
		await assertRefused(
			() => updateSchedule(principalA, schedule.id, { durationMinutes: 0 }),
			"INVALID_INPUT",
		);
		await assertRefused(
			() =>
				updateSchedule(principalA, schedule.id, {
					bufferBeforeMinutes: -5,
				}),
			"INVALID_INPUT",
		);
		await assertRefused(
			() => updateSchedule(principalA, schedule.id, { horizonDays: 0 }),
			"INVALID_INPUT",
		);
	});

	await t.test("a weekday outside 0..6 is refused", async () => {
		await assertRefused(
			() =>
				replaceAvailability(principalA, schedule.id, [
					{ weekday: 7, startMinute: 540, endMinute: 600 },
				]),
			"INVALID_INPUT",
		);
	});

	await t.test("a window that ends before it starts is refused", async () => {
		await assertRefused(
			() =>
				replaceAvailability(principalA, schedule.id, [
					{ weekday: 2, startMinute: 17 * 60, endMinute: 9 * 60 },
				]),
			"INVALID_INPUT",
			"end after it starts",
		);
		// Equal start and end is an empty window, not a whole-day window.
		await assertRefused(
			() =>
				replaceAvailability(principalA, schedule.id, [
					{ weekday: 2, startMinute: 600, endMinute: 600 },
				]),
			"INVALID_INPUT",
		);
		// Minutes outside a day are refused before they reach Postgres.
		await assertRefused(
			() =>
				replaceAvailability(principalA, schedule.id, [
					{ weekday: 2, startMinute: -30, endMinute: 600 },
				]),
			"INVALID_INPUT",
		);
		await assertRefused(
			() =>
				replaceAvailability(principalA, schedule.id, [
					{ weekday: 2, startMinute: 600, endMinute: 1500 },
				]),
			"INVALID_INPUT",
		);
	});

	await t.test("overlapping windows on one day are refused", async () => {
		const error = await assertRefused(
			() =>
				replaceAvailability(principalA, schedule.id, [
					{ weekday: 4, startMinute: 9 * 60, endMinute: 12 * 60 },
					{ weekday: 4, startMinute: 11 * 60, endMinute: 14 * 60 },
				]),
			"INVALID_INPUT",
			"overlapping",
		);
		assert.ok(
			error.message.includes("Thursday"),
			`message should name the day, got ${JSON.stringify(error.message)}`,
		);
	});

	await t.test("touching windows and different days are allowed", async () => {
		const saved = await replaceAvailability(principalA, schedule.id, [
			{ weekday: 4, startMinute: 9 * 60, endMinute: 12 * 60 },
			{ weekday: 4, startMinute: 12 * 60, endMinute: 14 * 60 },
			{ weekday: 5, startMinute: 9 * 60, endMinute: 12 * 60 },
		]);
		assert.equal(saved.availability.length, 3);
	});

	await t.test("an inverted one-off block is refused", async () => {
		await assertRefused(
			() =>
				replaceExceptions(principalA, schedule.id, [
					{
						startsAt: new Date("2030-01-02T17:00:00Z"),
						endsAt: new Date("2030-01-02T09:00:00Z"),
					},
				]),
			"INVALID_INPUT",
			"end after it starts",
		);
	});

	await t.test("blocks and weekly hours coexist", async () => {
		const startsAt = new Date("2030-07-04T13:00:00Z");
		const endsAt = new Date("2030-07-04T21:00:00Z");
		const saved = await replaceExceptions(principalA, schedule.id, [
			{ startsAt, endsAt, reason: "Holiday" },
		]);
		assert.equal(saved.exceptions.length, 1);
		assert.equal(saved.exceptions[0].reason, "Holiday");
		assert.equal(
			saved.exceptions[0].startsAt.toISOString(),
			startsAt.toISOString(),
		);
		assert.equal(
			saved.exceptions[0].endsAt.toISOString(),
			endsAt.toISOString(),
		);
		// Saving blocks must not disturb the weekly set.
		assert.equal(saved.availability.length, 3);
	});

	await t.test(
		"changing the timezone never moves an existing booking",
		async () => {
			// A booking is a UTC instant. Changing how the *windows* are read must
			// leave it exactly where the customer bought it.
			const startsAt = new Date("2030-05-06T14:00:00Z");
			const endsAt = new Date("2030-05-06T14:30:00Z");
			const [booking] = await db
				.insert(bookings)
				.values({
					scheduleId: schedule.id,
					creatorId: creatorA,
					userId: creatorA,
					startsAt,
					endsAt,
					status: "confirmed",
					chargedCredits: 0,
				})
				.returning();

			await updateSchedule(principalA, schedule.id, {
				timezone: "Asia/Tokyo",
			});

			const [reread] = await db
				.select()
				.from(bookings)
				.where(eq(bookings.id, booking.id));
			assert.equal(reread.startsAt.toISOString(), startsAt.toISOString());
			assert.equal(reread.endsAt.toISOString(), endsAt.toISOString());
			// The weekly windows keep their wall-clock minutes; only the zone reads
			// differently, which is the intended effect.
			const detail = await getSchedule(principalA, schedule.id);
			assert.equal(detail.timezone, "Asia/Tokyo");
			assert.deepEqual(
				detail.availability.map((row) => row.startMinute),
				[9 * 60, 12 * 60, 9 * 60],
			);

			await db.delete(bookings).where(eq(bookings.id, booking.id));
			await updateSchedule(principalA, schedule.id, {
				timezone: settings.timezone,
			});
		},
	);

	await t.test("a rejected set leaves the previous set intact", async () => {
		const before = await getSchedule(principalA, schedule.id);
		await assertRefused(
			() =>
				replaceAvailability(principalA, schedule.id, [
					{ weekday: 1, startMinute: 10 * 60, endMinute: 11 * 60 },
					{ weekday: 1, startMinute: 10 * 60 + 30, endMinute: 12 * 60 },
				]),
			"INVALID_INPUT",
		);
		const after = await getSchedule(principalA, schedule.id);
		assert.deepEqual(
			after.availability.map((row) => row.id),
			before.availability.map((row) => row.id),
		);
	});

	await t.test(
		"creator B cannot read or write creator A's schedule",
		async () => {
			// Not found by ID and not found by slug: the row's existence must not leak.
			await assertRefused(
				() => getSchedule(principalB, schedule.id),
				"NOT_FOUND",
			);
			await assertRefused(
				() => getSchedule(principalB, schedule.slug),
				"NOT_FOUND",
			);
			await assertRefused(
				() =>
					updateSchedule(principalB, schedule.id, {
						name: "Hijacked",
						timezone: "Europe/London",
					}),
				"NOT_FOUND",
			);
			await assertRefused(
				() =>
					replaceAvailability(principalB, schedule.id, [
						{ weekday: 6, startMinute: 0, endMinute: 60 },
					]),
				"NOT_FOUND",
			);
			await assertRefused(
				() =>
					replaceExceptions(principalB, schedule.id, [
						{
							startsAt: new Date("2030-01-01T00:00:00Z"),
							endsAt: new Date("2030-01-01T01:00:00Z"),
						},
					]),
				"NOT_FOUND",
			);

			// B's listing is empty, and A's schedule is byte-for-byte unchanged.
			assert.deepEqual(await listSchedules(principalB), []);
			const untouched = await getSchedule(principalA, schedule.id);
			assert.equal(untouched.name, settings.name);
			assert.equal(untouched.timezone, settings.timezone);
			assert.equal(untouched.availability.length, 3);
			assert.equal(untouched.exceptions.length, 1);
		},
	);

	await t.test("creator B may reuse creator A's slug", async () => {
		// The unique constraint is per creator, so the same public name is not
		// a global namespace.
		const theirs = await createSchedule(principalB, {
			...settings,
			name: "Their own hours",
		});
		assert.notEqual(theirs.id, schedule.id);
		assert.equal(theirs.slug, schedule.slug);
		assert.deepEqual(
			(await listSchedules(principalB)).map((row) => row.id),
			[theirs.id],
		);
	});

	await t.test("a duplicate slug within one creator is refused", async () => {
		await assertRefused(
			() => createSchedule(principalA, { ...settings }),
			"SLUG_TAKEN",
		);
	});

	await t.test(
		"sample schedules are recognised and never mutated",
		async () => {
			const sampleId = `sample-schedule-${creatorA}`;
			assert.equal(isSampleScheduleId(sampleId), true);
			assert.equal(isSampleScheduleId(schedule.id), false);

			// Seed the demo through the real sample path, as loading the workspace does.
			await seedSampleSchedule(db, creatorA);
			// Loading twice must not duplicate or fail.
			await seedSampleSchedule(db, creatorA);

			const sampleWindows = await db
				.select()
				.from(bookingAvailability)
				.where(eq(bookingAvailability.scheduleId, sampleId));
			assert.equal(sampleWindows.length, SAMPLE_SCHEDULE.weekdays.length);

			await assertRefused(
				() => updateSchedule(principalA, sampleId, { name: "Edited sample" }),
				"SAMPLE_IMMUTABLE",
			);
			await assertRefused(
				() =>
					replaceAvailability(principalA, sampleId, [
						{ weekday: 2, startMinute: 540, endMinute: 600 },
					]),
				"SAMPLE_IMMUTABLE",
			);
			await assertRefused(
				() => replaceExceptions(principalA, sampleId, []),
				"SAMPLE_IMMUTABLE",
			);

			// It remains readable, so the demo screen still works.
			const readable = await getSchedule(principalA, sampleId);
			assert.equal(readable.isSample, true);
			assert.equal(readable.name, SAMPLE_SCHEDULE.name);
			assert.equal(
				readable.availability.length,
				SAMPLE_SCHEDULE.weekdays.length,
			);

			// Removing the sample deletes only the demo, never the creator's own row.
			await removeSampleSchedule(db, creatorA);
			assert.equal(
				await db.query.bookingSchedules
					.findFirst({
						where: eq(bookingSchedules.id, sampleId),
					})
					.then((row) => row ?? null),
				null,
			);
			const own = await getSchedule(principalA, schedule.id);
			assert.equal(own.name, settings.name);
			assert.equal(own.availability.length, 3);
		},
	);

	await t.test("exceptionsSchema accepts ISO strings from the encoder", () => {
		// The dashboard sends strings; they must become instants exactly.
		const parsed = exceptionsSchema.parse([
			{
				startsAt: "2030-03-01T09:00:00.000Z",
				endsAt: "2030-03-01T17:00:00.000Z",
				reason: "  Travel  ",
			},
		]);
		assert.equal(parsed[0].startsAt.toISOString(), "2030-03-01T09:00:00.000Z");
		assert.equal(parsed[0].reason, "Travel");
	});
});
