/**
 * The webhook has already verified its signature before this parsing runs, so
 * the only danger left is misinterpretation: reading the wrong attendee, or
 * accepting a payload that has no booking identity and inventing one. A guessed
 * uid would make an unknown delivery a replayable debit, so these cases pin
 * strictness rather than permissiveness.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readCalBooking, readCalTrigger } from "@/lib/cal-webhook";

const envelope = (
	payload: Record<string, unknown>,
	trigger = "BOOKING_CREATED",
) => ({
	triggerEvent: trigger,
	createdAt: "2026-11-13T12:00:00.000Z",
	payload,
});

const attendee = { name: "Booker One", email: "Booker@Example.test" };

test("a booking payload yields the booking identity we charge against", () => {
	const booking = readCalBooking(
		envelope({
			uid: "bk_123",
			eventTypeId: 4242,
			startTime: "2026-12-01T09:00:00.000Z",
			attendees: [attendee, { email: "guest@example.test" }],
		}),
	);
	assert.deepEqual(booking, {
		uid: "bk_123",
		eventTypeId: 4242,
		// Attendee 0 is the booker; a guest must not become the payer.
		email: "Booker@Example.test",
		startsAt: new Date("2026-12-01T09:00:00.000Z"),
	});
});

test("a numeric event type sent as a string is still read", () => {
	const booking = readCalBooking(
		envelope({ uid: "bk_1", eventTypeId: "4242", attendees: [attendee] }),
	);
	assert.equal(booking?.eventTypeId, 4242);
});

test("a payload without a booking identity is refused, not guessed", () => {
	// Missing uid: there is nothing to make the debit idempotent against.
	assert.equal(
		readCalBooking(envelope({ eventTypeId: 1, attendees: [attendee] })),
		null,
	);
	assert.equal(
		readCalBooking(envelope({ uid: "   ", attendees: [attendee] })),
		null,
	);
	// Missing booker email: we would not know whose credits to spend.
	assert.equal(readCalBooking(envelope({ uid: "bk_2", eventTypeId: 1 })), null);
	assert.equal(readCalBooking(envelope({ uid: "bk_2", attendees: [] })), null);
	assert.equal(
		readCalBooking(envelope({ uid: "bk_2", attendees: [{ email: 7 }] })),
		null,
	);
});

test("an unreadable envelope never produces a booking", () => {
	assert.equal(readCalBooking(null), null);
	assert.equal(readCalBooking("BOOKING_CREATED"), null);
	assert.equal(readCalBooking({ triggerEvent: "BOOKING_CREATED" }), null);
	// The flat MEETING_STARTED shape has booking fields at the root; it carries no
	// nested payload, so it must not be mined for one.
	assert.equal(
		readCalBooking({ triggerEvent: "MEETING_STARTED", uid: "bk_3" }),
		null,
	);
});

test("an event type id that is not a number stays unknown", () => {
	const booking = readCalBooking(
		envelope({ uid: "bk_4", eventTypeId: "evt_abc", attendees: [attendee] }),
	);
	assert.ok(booking);
	assert.equal(booking.eventTypeId, null, "never coerced to a wrong plan");
});

test("a missing start time does not reject an otherwise valid booking", () => {
	// The time is display data; the booking uid is what the debit depends on.
	const booking = readCalBooking(
		envelope({ uid: "bk_5", eventTypeId: 9, attendees: [attendee] }),
	);
	assert.equal(booking?.startsAt, null);
	assert.equal(booking?.uid, "bk_5");
});

test("the trigger is read without trusting its type", () => {
	assert.equal(
		readCalTrigger(envelope({}, "BOOKING_CANCELLED")),
		"BOOKING_CANCELLED",
	);
	assert.equal(readCalTrigger({ triggerEvent: 42 }), "unknown");
	assert.equal(readCalTrigger(null), "unknown");
	assert.equal(readCalTrigger({}), "unknown");
});
