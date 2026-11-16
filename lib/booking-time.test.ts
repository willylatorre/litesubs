import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findOverlappingWindows,
	formatMinutes,
	isValidTimeZone,
	parseTimeToMinutes,
	slugify,
	utcToZonedInputValue,
	zonedInputValueToUtc,
	zonedTimeToUtc,
} from "@/lib/booking-time";

test("timezones are validated by Intl, not by a hardcoded list", () => {
	assert.equal(isValidTimeZone("America/New_York"), true);
	assert.equal(isValidTimeZone("Europe/London"), true);
	assert.equal(isValidTimeZone("UTC"), true);
	// Case-insensitive IANA lookup is normalised by the runtime, not rejected.
	assert.equal(isValidTimeZone("america/new_york"), true);

	assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
	assert.equal(isValidTimeZone(""), false);
	assert.equal(isValidTimeZone("  "), false);
	// Offsets have no DST rules, so the same windows would drift through the year.
	assert.equal(isValidTimeZone("+05:00"), false);
	assert.equal(isValidTimeZone("-08:00"), false);
});

test("minutes-of-day and clock strings round-trip", () => {
	assert.equal(formatMinutes(0), "00:00");
	assert.equal(formatMinutes(9 * 60 + 30), "09:30");
	assert.equal(formatMinutes(1440), "24:00");

	assert.equal(parseTimeToMinutes("09:30"), 570);
	assert.equal(parseTimeToMinutes("9:30"), 570);
	assert.equal(parseTimeToMinutes("24:00"), 1440);
	assert.equal(parseTimeToMinutes("24:01"), null);
	assert.equal(parseTimeToMinutes("9:70"), null);
	assert.equal(parseTimeToMinutes("noon"), null);
});

test("overlap is found per weekday, and touching windows are not overlap", () => {
	assert.equal(
		findOverlappingWindows([
			{ weekday: 1, startMinute: 540, endMinute: 720 },
			{ weekday: 1, startMinute: 660, endMinute: 840 },
		]) !== null,
		true,
	);
	assert.equal(
		findOverlappingWindows([
			{ weekday: 1, startMinute: 540, endMinute: 720 },
			{ weekday: 1, startMinute: 720, endMinute: 840 },
		]),
		null,
	);
	// Same times on different days never conflict.
	assert.equal(
		findOverlappingWindows([
			{ weekday: 1, startMinute: 540, endMinute: 720 },
			{ weekday: 2, startMinute: 540, endMinute: 720 },
		]),
		null,
	);
});

test("a wall-clock time in a zone becomes the correct UTC instant across DST", () => {
	// New York is UTC-5 in January and UTC-4 in July.
	assert.equal(
		zonedTimeToUtc(
			{ year: 2030, month: 1, day: 15, hour: 9, minute: 0 },
			"America/New_York",
		).toISOString(),
		"2030-01-15T14:00:00.000Z",
	);
	assert.equal(
		zonedTimeToUtc(
			{ year: 2030, month: 7, day: 15, hour: 9, minute: 0 },
			"America/New_York",
		).toISOString(),
		"2030-07-15T13:00:00.000Z",
	);

	// The editor's datetime-local round-trip preserves the wall clock.
	const instant = zonedInputValueToUtc("2030-07-15T09:00", "America/New_York");
	assert.ok(instant);
	assert.equal(instant.toISOString(), "2030-07-15T13:00:00.000Z");
	assert.equal(
		utcToZonedInputValue(instant, "America/New_York"),
		"2030-07-15T09:00",
	);
});

test("a nonexistent local time never produces a malformed instant", () => {
	// 02:30 on 2030-03-10 does not exist in New York (the clock jumps to 03:00).
	const shifted = zonedTimeToUtc(
		{ year: 2030, month: 3, day: 10, hour: 2, minute: 30 },
		"America/New_York",
	);
	assert.equal(Number.isNaN(shifted.getTime()), false);
	// It resolves to the first real instant after the gap (03:30 EDT), never to
	// an instant that reads back as 01:30, which would duplicate the prior hour.
	assert.equal(shifted.toISOString(), "2030-03-10T07:30:00.000Z");
});

test("a repeated autumn hour resolves to one deterministic instant", () => {
	// 01:30 happens twice on 2030-11-03 in New York. Storing it once, always the
	// first occurrence, is what stops a duplicated local time from producing two
	// slots for the same wall clock.
	const repeated = zonedTimeToUtc(
		{ year: 2030, month: 11, day: 3, hour: 1, minute: 30 },
		"America/New_York",
	);
	assert.equal(repeated.toISOString(), "2030-11-03T05:30:00.000Z");
	assert.equal(
		utcToZonedInputValue(repeated, "America/New_York"),
		"2030-11-03T01:30",
	);
});

test("a name becomes a URL-safe slug", () => {
	assert.equal(slugify("Weekly Office Hours"), "weekly-office-hours");
	assert.equal(slugify("  Café & co.  "), "caf-co");
	assert.equal(slugify("--already-slugged--"), "already-slugged");
	assert.equal(slugify("!!!"), "");
});
