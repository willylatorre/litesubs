/**
 * `subtractBusyIntervals` is the whole of "Google busy time hides slots" and
 * `parseStateCookie` is the OAuth state binding. Both are pure, so these tests
 * run offline with no database and no network. Slot generation itself is owned
 * by the availability slice.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	encodeStateCookie,
	normalizeIntervals,
	parseStateCookie,
	subtractBusyIntervals,
} from "@/lib/google-calendar";

const at = (hour: number, minute = 0) =>
	new Date(Date.UTC(2026, 4, 4, hour, minute));

const slot = (startHour: number, endHour: number) => ({
	id: `slot-${startHour}-${endHour}`,
	start: at(startHour),
	end: at(endHour),
});

test("a busy interval removes an overlapping slot", () => {
	const slots = [slot(9, 10), slot(10, 11), slot(11, 12)];
	const busy = [{ start: at(10, 15), end: at(10, 45) }];

	const remaining = subtractBusyIntervals(slots, busy);

	assert.deepEqual(
		remaining.map((s) => s.id),
		["slot-9-10", "slot-11-12"],
	);
});

test("a fully-contained busy block removes the slot that contains it", () => {
	const slots = [slot(9, 10)];
	const busy = [{ start: at(9, 15), end: at(9, 30) }];

	assert.deepEqual(subtractBusyIntervals(slots, busy), []);
});

test("a slot fully inside a long busy block is removed", () => {
	const slots = [slot(9, 10), slot(10, 11), slot(11, 12)];
	const busy = [{ start: at(8), end: at(13) }];

	assert.deepEqual(subtractBusyIntervals(slots, busy), []);
});

test("adjacency is not an overlap: back-to-back stays bookable", () => {
	const slots = [slot(9, 10), slot(10, 11)];
	// Busy exactly equals slot 10-11.
	const busy = [{ start: at(10), end: at(11) }];
	assert.deepEqual(
		subtractBusyIntervals(slots, busy).map((s) => s.id),
		["slot-9-10"],
	);

	const touchingBefore = [{ start: at(8), end: at(9) }];
	assert.deepEqual(
		subtractBusyIntervals(slots, touchingBefore).map((s) => s.id),
		["slot-9-10", "slot-10-11"],
	);
});

test("a busy block that only touches a boundary leaves the slot", () => {
	const slots = [slot(9, 10)];
	const busy = [{ start: at(10), end: at(11) }];

	assert.equal(subtractBusyIntervals(slots, busy).length, 1);
});

test("no busy intervals leaves every slot unchanged", () => {
	const slots = [slot(9, 10), slot(10, 11)];

	assert.deepEqual(subtractBusyIntervals(slots, []), slots);
});

test("empty slot input stays empty", () => {
	assert.deepEqual(
		subtractBusyIntervals([], [{ start: at(9), end: at(10) }]),
		[],
	);
});

test("multiple busy blocks are all subtracted", () => {
	const slots = [slot(9, 10), slot(10, 11), slot(11, 12), slot(12, 13)];
	const busy = [
		{ start: at(9, 30), end: at(9, 45) },
		{ start: at(12), end: at(12, 30) },
	];

	assert.deepEqual(
		subtractBusyIntervals(slots, busy).map((s) => s.id),
		["slot-10-11", "slot-11-12"],
	);
});

test("extra slot fields survive filtering", () => {
	const slots = [
		{ id: "a", start: at(9), end: at(10), price: 100, label: "Morning" },
	];
	const busy = [{ start: at(11), end: at(12) }];

	const [remaining] = subtractBusyIntervals(slots, busy);
	assert.equal(remaining.price, 100);
	assert.equal(remaining.label, "Morning");
});

test("zero-length and inverted busy blocks are ignored", () => {
	const slots = [slot(9, 10)];
	const busy = [
		{ start: at(9, 30), end: at(9, 30) },
		{ start: at(9, 45), end: at(9, 15) },
	];

	assert.equal(subtractBusyIntervals(slots, busy).length, 1);
});

test("ISO strings and Date objects are interchangeable", () => {
	const slots = [
		{ id: "s", start: at(9).toISOString(), end: at(10).toISOString() },
	];
	const busy = [{ start: at(9, 30), end: new Date(at(10, 30).getTime()) }];

	assert.deepEqual(subtractBusyIntervals(slots, busy), []);
});

test("normalizeIntervals drops invalid ranges and keeps valid ones", () => {
	const normalized = normalizeIntervals([
		{ start: at(9), end: at(10) },
		{ start: at(10), end: at(10) },
		{ start: at(11), end: at(10) },
	]);

	assert.equal(normalized.length, 1);
	assert.equal(normalized[0].end - normalized[0].start, 60 * 60 * 1000);
});

test("a malformed slot is kept, never dropped, and never throws", () => {
	// Availability rendering must not lose a slot because the interval math
	// could not read its bounds.
	const slots = [
		{ id: "bad", start: "not-a-date", end: "also-not-a-date" },
		{ id: "good", start: at(9), end: at(10) },
	];
	const busy = [{ start: at(9), end: at(10) }];

	const remaining = subtractBusyIntervals(slots, busy);
	assert.deepEqual(
		remaining.map((s) => s.id),
		["bad"],
	);
});

test("a malformed busy interval is ignored, not fatal", () => {
	const slots = [slot(9, 10)];
	const busy = [
		{ start: "garbage", end: at(10) },
		{ start: at(20), end: at(21) },
	];

	assert.equal(subtractBusyIntervals(slots, busy).length, 1);
});

/* -------------------------------------------------------------------------- */
/* OAuth state binding                                                        */
/* -------------------------------------------------------------------------- */

test("state cookie round-trips the user id and nonce", () => {
	const parsed = parseStateCookie(
		encodeStateCookie("user-abc", "9f2b6c1e-aaaa-bbbb-cccc-1234567890ab"),
	);

	assert.deepEqual(parsed, {
		userId: "user-abc",
		nonce: "9f2b6c1e-aaaa-bbbb-cccc-1234567890ab",
	});
});

test("a user id containing a colon still parses on the last colon", () => {
	// Better Auth ids are opaque; splitting on the first colon would truncate one
	// that happened to contain a colon.
	const parsed = parseStateCookie(
		encodeStateCookie("user:with:colons", "nonce"),
	);

	assert.deepEqual(parsed, { userId: "user:with:colons", nonce: "nonce" });
});

test("a cookie without a nonce or user is rejected", () => {
	assert.equal(parseStateCookie("no-separator"), null);
	assert.equal(parseStateCookie(":nonce-only"), null);
	assert.equal(parseStateCookie("user-only:"), null);
	assert.equal(parseStateCookie(""), null);
});
