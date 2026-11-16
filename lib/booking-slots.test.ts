/**
 * Slot math is where booking bugs hide, and the expensive ones are temporal:
 * a slot that silently moves an hour, a date skipped at a DST boundary, or an
 * overlap that lets two customers book one time.
 *
 * These cases are pure and offline. They use real DST transitions rather than
 * mocked offsets, because the whole point is that the zone data is the source of
 * truth.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	generateSlots,
	isSlotBookable,
	isValidTimeZone,
	wallTimeExists,
	zonedToUtc,
	zonedWeekday,
	zoneOffsetMs,
	type SlotInput,
} from "@/lib/booking-slots";

const MINUTE = 60_000;

function baseInput(overrides: Partial<SlotInput> = {}): SlotInput {
	return {
		durationMinutes: 30,
		bufferBeforeMinutes: 0,
		bufferAfterMinutes: 0,
		horizonDays: 1,
		timeZone: "UTC",
		// 2026-12-01 is a Tuesday.
		availability: [{ weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 }],
		exceptions: [],
		bookings: [],
		now: new Date("2026-12-01T00:00:00.000Z"),
		...overrides,
	};
}

test("offsets follow the zone rather than a fixed guess", () => {
	// Madrid is CET (+1) in winter and CEST (+2) in summer.
	assert.equal(
		zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), "Europe/Madrid"),
		60 * MINUTE,
	);
	assert.equal(
		zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "Europe/Madrid"),
		120 * MINUTE,
	);
});

test("a wall-clock window becomes the matching instant in that zone", () => {
	// 09:00 Madrid in winter is 08:00 UTC.
	const start = zonedToUtc(2026, 1, 15, 9, 0, "Europe/Madrid");
	assert.equal(start.toISOString(), "2026-01-15T08:00:00.000Z");
	// The same wall time in summer is an hour earlier in UTC.
	const summer = zonedToUtc(2026, 7, 15, 9, 0, "Europe/Madrid");
	assert.equal(summer.toISOString(), "2026-07-15T07:00:00.000Z");
});

test("slots keep their local wall-clock time across a DST change", () => {
	// US spring forward is 2026-03-08. A 09:00 local window must stay 09:00 local
	// on both sides, which means its UTC instant shifts by an hour.
	const before = zonedToUtc(2026, 3, 7, 9, 0, "America/New_York");
	const after = zonedToUtc(2026, 3, 9, 9, 0, "America/New_York");
	// 47 hours, not 48: one clock hour was lost to the transition.
	assert.equal(after.getTime() - before.getTime(), 47 * 60 * MINUTE);
});

test("the spring-forward gap is detected instead of silently shifted", () => {
	// 02:30 does not exist on 2026-03-08 in New York.
	assert.equal(wallTimeExists(2026, 3, 8, 2, 30, "America/New_York"), false);
	// 01:30 and 03:30 do.
	assert.equal(wallTimeExists(2026, 3, 8, 1, 30, "America/New_York"), true);
	assert.equal(wallTimeExists(2026, 3, 8, 3, 30, "America/New_York"), true);
});

test("weekly windows produce slots on the right local weekday", () => {
	const slots = generateSlots(baseInput());
	assert.equal(slots.length, 4, "09:00, 09:30, 10:00, 10:30");
	assert.equal(slots[0].start.toISOString(), "2026-12-01T09:00:00.000Z");
	assert.equal(slots[3].start.toISOString(), "2026-12-01T10:30:00.000Z");
});

test("only the configured weekday is offered", () => {
	// Monday the 30th has no window, but a 1-day horizon reaches Tuesday the 1st,
	// so exactly that day's slots are offered and nothing from the Monday.
	const slots = generateSlots(
		baseInput({ now: new Date("2026-11-30T00:00:00.000Z"), horizonDays: 1 }),
	);
	assert.equal(slots.length, 4);
	assert.ok(
		slots.every((slot) => zonedWeekday(slot.start, "UTC") === 2),
		"no slot may fall on the unconfigured Monday",
	);
	// A horizon of 0 days from a Saturday reaches no Tuesday at all.
	assert.deepEqual(
		generateSlots(
			baseInput({ now: new Date("2026-11-28T00:00:00.000Z"), horizonDays: 0 }),
		),
		[],
	);
});

test("a slot needs room for its full duration inside the window", () => {
	const slots = generateSlots(baseInput({ durationMinutes: 45 }));
	// 09:00 and 09:45 fit; 10:30 would end at 11:15, past the 11:00 close.
	assert.deepEqual(
		slots.map((slot) => slot.start.toISOString()),
		["2026-12-01T09:00:00.000Z", "2026-12-01T09:45:00.000Z"],
	);
});

test("buffers reserve the gap around a booking", () => {
	const taken = {
		start: new Date("2026-12-01T09:30:00.000Z"),
		end: new Date("2026-12-01T10:00:00.000Z"),
	};
	const withoutBuffer = generateSlots(baseInput({ bookings: [taken] }));
	assert.ok(
		withoutBuffer.some(
			(slot) => slot.start.toISOString() === "2026-12-01T10:00:00.000Z",
		),
		"back-to-back is allowed with no buffer",
	);

	const withBuffer = generateSlots(
		baseInput({ bookings: [taken], bufferAfterMinutes: 15 }),
	);
	assert.equal(
		withBuffer.some(
			(slot) => slot.start.toISOString() === "2026-12-01T10:00:00.000Z",
		),
		false,
		"a 15-minute buffer blocks the immediately following slot",
	);
});

test("a confirmed booking removes exactly the overlapping slots", () => {
	const slots = generateSlots(
		baseInput({
			bookings: [
				{
					start: new Date("2026-12-01T09:30:00.000Z"),
					end: new Date("2026-12-01T10:00:00.000Z"),
				},
			],
		}),
	);
	assert.deepEqual(
		slots.map((slot) => slot.start.toISOString()),
		[
			"2026-12-01T09:00:00.000Z",
			"2026-12-01T10:00:00.000Z",
			"2026-12-01T10:30:00.000Z",
		],
	);
});

test("an exception blocks only the times it covers", () => {
	const slots = generateSlots(
		baseInput({
			exceptions: [
				{
					start: new Date("2026-12-01T09:00:00.000Z"),
					end: new Date("2026-12-01T10:00:00.000Z"),
				},
			],
		}),
	);
	assert.deepEqual(
		slots.map((slot) => slot.start.toISOString()),
		["2026-12-01T10:00:00.000Z", "2026-12-01T10:30:00.000Z"],
	);
});

test("external busy time is subtracted like a booking", () => {
	const slots = generateSlots(
		baseInput({
			busy: [
				{
					start: new Date("2026-12-01T10:00:00.000Z"),
					end: new Date("2026-12-01T10:30:00.000Z"),
				},
			],
		}),
	);
	assert.equal(
		slots.some(
			(slot) => slot.start.toISOString() === "2026-12-01T10:00:00.000Z",
		),
		false,
	);
});

test("past times and the notice period are never offered", () => {
	// Now is 09:15 with a 15-minute notice, so the earliest bookable instant is
	// exactly 09:30: 09:00 is past, 09:30 is allowed (the boundary is inclusive).
	const slots = generateSlots(
		baseInput({
			now: new Date("2026-12-01T09:15:00.000Z"),
			horizonDays: 0,
			minimumNoticeMinutes: 15,
		}),
	);
	assert.deepEqual(
		slots.map((slot) => slot.start.toISOString()),
		[
			"2026-12-01T09:30:00.000Z",
			"2026-12-01T10:00:00.000Z",
			"2026-12-01T10:30:00.000Z",
		],
	);
	// A 30-minute notice pushes past 09:45, so 09:30 drops out.
	assert.deepEqual(
		generateSlots(
			baseInput({
				now: new Date("2026-12-01T09:15:00.000Z"),
				horizonDays: 0,
				minimumNoticeMinutes: 30,
			}),
		).map((slot) => slot.start.toISOString()),
		["2026-12-01T10:00:00.000Z", "2026-12-01T10:30:00.000Z"],
	);
});

test("the horizon bounds how far ahead a slot appears", () => {
	// A 0-day horizon means "today only": from a Tuesday, Tuesday's slots appear.
	assert.equal(
		generateSlots(
			baseInput({ now: new Date("2026-12-01T00:00:00.000Z"), horizonDays: 0 }),
		).length,
		4,
	);
	// The same 0-day horizon one day earlier sees no Tuesday at all.
	assert.equal(
		generateSlots(
			baseInput({ now: new Date("2026-12-02T00:00:00.000Z"), horizonDays: 0 }),
		).length,
		0,
	);
});

test("overlapping windows do not offer the same start twice", () => {
	const slots = generateSlots(
		baseInput({
			availability: [
				{ weekday: 2, startMinute: 9 * 60, endMinute: 10 * 60 },
				{ weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 },
			],
		}),
	);
	const starts = slots.map((slot) => slot.start.toISOString());
	assert.equal(new Set(starts).size, starts.length);
});

test("booking re-checks the slot instead of trusting the client", () => {
	const input = baseInput();
	const valid = isSlotBookable(input, new Date("2026-12-01T09:00:00.000Z"));
	assert.ok(valid);
	// A time the page never offered is refused.
	assert.equal(
		isSlotBookable(input, new Date("2026-12-01T09:07:00.000Z")),
		null,
	);
	assert.equal(
		isSlotBookable(input, new Date("2026-12-01T19:00:00.000Z")),
		null,
	);
});

test("a zero-duration schedule produces nothing rather than infinite slots", () => {
	assert.deepEqual(generateSlots(baseInput({ durationMinutes: 0 })), []);
});

test("timezone names are validated instead of assumed", () => {
	assert.equal(isValidTimeZone("Europe/Madrid"), true);
	assert.equal(isValidTimeZone("Not/AZone"), false);
});

test("a window crossing midnight stays on its own local day", () => {
	// 23:00–23:59 Tuesday in Tokyo is Tuesday 14:00 UTC; iterating by UTC date
	// would be a day off.
	const slots = generateSlots(
		baseInput({
			timeZone: "Asia/Tokyo",
			horizonDays: 1,
			availability: [{ weekday: 2, startMinute: 23 * 60, endMinute: 24 * 60 }],
		}),
	);
	assert.ok(slots.length > 0, "the 23:00 local slot is offered");
	assert.equal(zonedWeekday(slots[0].start, "Asia/Tokyo"), 2);
});
