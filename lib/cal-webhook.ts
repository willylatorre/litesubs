/**
 * Reading Cal.com's webhook envelope.
 *
 * Kept separate from the route so the parsing rules are testable without a
 * request, and deliberately strict: a booking we cannot confidently identify is
 * reported as unreadable rather than half-interpreted. Guessing a uid would turn
 * an unknown delivery into a replayable debit, which is the one mistake here
 * that costs a customer money.
 *
 * Cal.com delivers booking triggers as `{ triggerEvent, createdAt, payload }`.
 * Only that nested shape is accepted; the flat MEETING_STARTED/MEETING_ENDED
 * format has no booking identity we act on.
 */

export type CalBookingEvent = {
	/** Cal.com's stable booking identity; the idempotency boundary. */
	uid: string;
	eventTypeId: number | null;
	/** The booker's email, taken from the first attendee. */
	email: string;
	startsAt: Date | null;
};

export function readCalTrigger(body: unknown): string {
	if (typeof body !== "object" || body === null) return "unknown";
	const trigger = (body as { triggerEvent?: unknown }).triggerEvent;
	return typeof trigger === "string" ? trigger : "unknown";
}

export function readCalBooking(body: unknown): CalBookingEvent | null {
	if (typeof body !== "object" || body === null) return null;
	const booking = (body as { payload?: unknown }).payload;
	if (typeof booking !== "object" || booking === null) return null;
	const record = booking as Record<string, unknown>;

	const uid = typeof record.uid === "string" ? record.uid.trim() : "";
	if (!uid) return null;

	const rawEventTypeId = record.eventTypeId;
	const eventTypeId =
		typeof rawEventTypeId === "number"
			? rawEventTypeId
			: typeof rawEventTypeId === "string" && /^\d+$/.test(rawEventTypeId)
				? Number(rawEventTypeId)
				: null;

	// Cal.com echoes the booker as attendee 0, including for seated event types.
	const attendees = Array.isArray(record.attendees) ? record.attendees : [];
	const first = attendees[0] as { email?: unknown } | undefined;
	const email = typeof first?.email === "string" ? first.email.trim() : "";
	if (!email) return null;

	const startsAt =
		typeof record.startTime === "string" &&
		!Number.isNaN(new Date(record.startTime).getTime())
			? new Date(record.startTime)
			: null;

	return { uid, eventTypeId, email, startsAt };
}

/** Triggers that spend credits. A reschedule is the same booking, not a new one. */
export const CREDIT_SPENDING_TRIGGERS = [
	"BOOKING_CREATED",
	"BOOKING_RESCHEDULED",
] as const;

/** Triggers that give back what the booking spent. */
export const CREDIT_RESTORING_TRIGGERS = [
	"BOOKING_CANCELLED",
	"BOOKING_REJECTED",
] as const;
