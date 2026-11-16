/**
 * Slot generation for native bookings.
 *
 * Two rules shape this module:
 *
 * - Availability is a *wall-clock* concept ("Tuesdays 9:00–17:00 in
 *   Europe/Madrid"), while bookings are *instants*. Converting between them is
 *   where DST bugs live, so the arithmetic is isolated here and tested against
 *   real transitions rather than trusted.
 * - It is pure. No database, no clock, no network: the caller supplies the
 *   confirmed bookings and busy intervals to subtract. That makes availability
 *   testable without a server, and keeps the expensive I/O out of the loop.
 */

/** Minutes since local midnight → hour/minute. */
function splitMinute(minute: number) {
	return { hour: Math.floor(minute / 60), minute: minute % 60 };
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 *
 * Computed by formatting the instant in the target zone and comparing that
 * wall-clock reading back against UTC. `Intl` is the only source of zone data
 * available without adding a timezone dependency.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	const parts = formatter.formatToParts(instant);
	const read = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);
	const asUtc = Date.UTC(
		read("year"),
		read("month") - 1,
		read("day"),
		read("hour"),
		read("minute"),
		read("second"),
	);
	return asUtc - instant.getTime();
}

/** True when the zone recognises this IANA name. */
export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

/**
 * A wall-clock time in `timeZone` as a UTC instant.
 *
 * Solved by guessing with the offset at the naive instant and correcting once,
 * which is what every timezone library does. A wall time that does not exist
 * (the spring-forward gap) resolves to *some* instant, so callers must use
 * `wallTimeExists` when the distinction matters — a slot that silently lands an
 * hour away is worse than no slot.
 */
export function zonedToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone: string,
): Date {
	const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
	const firstOffset = zoneOffsetMs(new Date(naive), timeZone);
	const firstGuess = naive - firstOffset;
	const secondOffset = zoneOffsetMs(new Date(firstGuess), timeZone);
	return new Date(naive - secondOffset);
}

/** Whether a wall-clock time actually occurs in the zone (DST has a gap). */
export function wallTimeExists(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone: string,
): boolean {
	const instant = zonedToUtc(year, month, day, hour, minute, timeZone);
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
	const parts = formatter.formatToParts(instant);
	const read = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);
	return (
		read("year") === year &&
		read("month") === month &&
		read("day") === day &&
		read("hour") === hour &&
		read("minute") === minute
	);
}

/** The local date parts of an instant in a zone. */
export function zonedDateParts(instant: Date, timeZone: string) {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		weekday: "short",
	});
	const parts = formatter.formatToParts(instant);
	const read = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		hour: read("hour"),
		minute: read("minute"),
	};
}

/** 0 = Sunday .. 6 = Saturday, in the zone. */
export function zonedWeekday(instant: Date, timeZone: string): number {
	const name = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
	}).format(instant);
	return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export type AvailabilityWindow = {
	/** 0 = Sunday .. 6 = Saturday. */
	weekday: number;
	/** Minutes since local midnight. */
	startMinute: number;
	endMinute: number;
};

export type TimeRange = { start: Date; end: Date };

export type SlotInput = {
	durationMinutes: number;
	bufferBeforeMinutes: number;
	bufferAfterMinutes: number;
	horizonDays: number;
	timeZone: string;
	availability: AvailabilityWindow[];
	exceptions: TimeRange[];
	/** Confirmed bookings to treat as taken. */
	bookings: TimeRange[];
	/** External calendar busy intervals (optional). */
	busy?: TimeRange[];
	/** The current instant; injected so the function stays pure. */
	now: Date;
	/**
	 * Minimum notice in minutes. A slot starting sooner than this is offered to
	 * nobody, which stops a booking page from advertising a time five minutes out.
	 */
	minimumNoticeMinutes?: number;
};

function overlaps(a: TimeRange, b: TimeRange) {
	return (
		a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime()
	);
}

const MS_PER_MINUTE = 60_000;

export type Slot = { start: Date; end: Date };

/**
 * Every bookable start time inside the horizon.
 *
 * A candidate is offered only when its full occupied span — including the
 * creator's buffers — fits inside one availability window for that local day,
 * avoids exceptions, confirmed bookings, and external busy time, occurs at a
 * real wall-clock time (never inside a DST gap), and respects the notice period.
 */
export function generateSlots(input: SlotInput): Slot[] {
	const {
		durationMinutes,
		bufferBeforeMinutes,
		bufferAfterMinutes,
		horizonDays,
		timeZone,
		availability,
		exceptions,
		bookings,
		busy = [],
		now,
		minimumNoticeMinutes = 0,
	} = input;
	if (durationMinutes <= 0) return [];

	// Buffers belong to the creator, not to one booking: they must hold on both
	// sides of *every* occupied range. Expanding only the candidate would let a
	// new slot start the instant an existing booking ends, which is exactly the
	// gap the creator asked for.
	const buffered = (range: TimeRange): TimeRange => ({
		start: new Date(
			range.start.getTime() - bufferBeforeMinutes * MS_PER_MINUTE,
		),
		end: new Date(range.end.getTime() + bufferAfterMinutes * MS_PER_MINUTE),
	});
	const busyRanges = [...bookings, ...busy, ...exceptions].map(buffered);
	const earliest = now.getTime() + minimumNoticeMinutes * MS_PER_MINUTE;
	// `horizonDays` is enforced by the day loop (today through today + N), so
	// there is no separate upper cutoff: a second one would silently drop the
	// last day and make the horizon mean something different than its name.
	const slots: Slot[] = [];

	// Walk local days rather than UTC hours: a window at 23:00 in a zone ahead of
	// UTC belongs to that local day, and iterating by UTC would split it.
	const startOfHorizon = zonedDateParts(now, timeZone);
	for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
		// Step whole days using a UTC anchor at noon so adding a day never lands
		// inside a DST gap and skips a date.
		const anchor = new Date(
			Date.UTC(
				startOfHorizon.year,
				startOfHorizon.month - 1,
				startOfHorizon.day + dayOffset,
				12,
			),
		);
		const { year, month, day } = zonedDateParts(anchor, timeZone);
		const weekday = zonedWeekday(anchor, timeZone);

		for (const window of availability) {
			if (window.weekday !== weekday) continue;
			// Candidates are laid out on the duration grid from the window's start.

			for (
				let offset = 0;
				window.startMinute + offset + durationMinutes <= window.endMinute;
				offset += durationMinutes
			) {
				const localMinute = window.startMinute + offset;
				const startHourNow = splitMinute(localMinute).hour;
				const startMinuteNow = splitMinute(localMinute).minute;
				if (
					!wallTimeExists(
						year,
						month,
						day,
						startHourNow,
						startMinuteNow,
						timeZone,
					)
				)
					continue;

				const start = zonedToUtc(
					year,
					month,
					day,
					startHourNow,
					startMinuteNow,
					timeZone,
				);
				const end = new Date(start.getTime() + durationMinutes * MS_PER_MINUTE);
				if (start.getTime() < earliest) continue;

				// The occupied span includes buffers, so back-to-back bookings keep
				// the gap the creator asked for.
				const occupied = {
					start: new Date(
						start.getTime() - bufferBeforeMinutes * MS_PER_MINUTE,
					),
					end: new Date(end.getTime() + bufferAfterMinutes * MS_PER_MINUTE),
				};
				if (busyRanges.some((range) => overlaps(occupied, range))) continue;

				slots.push({ start, end });
			}
		}
	}

	// Stable, de-duplicated order; two overlapping windows can propose one start.
	const seen = new Set<number>();
	return slots
		.filter((slot) => {
			const key = slot.start.getTime();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Whether one specific start time is bookable.
 *
 * Booking never trusts a client-supplied slot: the chosen start is re-checked
 * against the same rules the page used, so a crafted request cannot book an
 * unavailable time. The range is widened slightly because a client sends the
 * start it saw, and rounding must not turn a valid slot into a false negative.
 */
export function isSlotBookable(input: SlotInput, start: Date): Slot | null {
	const exact = generateSlots(input).find(
		(slot) => slot.start.getTime() === start.getTime(),
	);
	return exact ?? null;
}
