/**
 * Pure time and weekday helpers for booking schedules.
 *
 * Kept free of server imports so the dashboard editor, the service, and the
 * tests can all use one definition of "a weekly window" and one way to move
 * between a wall-clock time in a schedule's zone and a UTC instant.
 *
 * Storing a window as minutes-of-day in the schedule's timezone is what makes a
 * 09:00 window stay at 09:00 across a DST change; converting to UTC at read time
 * is what keeps a slot an unambiguous instant.
 */

/** 0 = Sunday, matching JavaScript's `Date#getDay` and the database check. */
export const WEEKDAYS = [
	{ value: 0, short: "Sun", long: "Sunday" },
	{ value: 1, short: "Mon", long: "Monday" },
	{ value: 2, short: "Tue", long: "Tuesday" },
	{ value: 3, short: "Wed", long: "Wednesday" },
	{ value: 4, short: "Thu", long: "Thursday" },
	{ value: 5, short: "Fri", long: "Friday" },
	{ value: 6, short: "Sat", long: "Saturday" },
] as const;

export function weekdayName(weekday: number): string {
	return WEEKDAYS[weekday]?.long ?? `Weekday ${weekday}`;
}

/** Minutes-of-day as `HH:MM`; 1440 renders as `24:00`. */
export function formatMinutes(minutes: number): string {
	const clamped = Math.max(0, minutes);
	const hours = Math.floor(clamped / 60);
	const rest = clamped % 60;
	return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** `HH:MM` (or `H:MM`) to minutes-of-day; null when it is not a time. */
export function parseTimeToMinutes(value: string): number | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 24 || minutes > 59) return null;
	const total = hours * 60 + minutes;
	return total > 1440 ? null : total;
}

/**
 * A schedule's timezone must be a real IANA zone: a made-up zone would silently
 * produce no slots, or the wrong ones, at booking time. `Intl` is the authority,
 * so no hardcoded list can go stale.
 *
 * UTC offsets such as `+05:00` are rejected even though `Intl` accepts them:
 * they carry no DST rules, so the same windows would drift through the year.
 */
export function isValidTimeZone(timeZone: string | null | undefined): boolean {
	const value = timeZone?.trim();
	if (!value || /^[+-]/.test(value)) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

/** IANA zones the runtime knows, for the editor's datalist suggestions. */
export function timeZoneSuggestions(): string[] {
	const zones =
		typeof Intl.supportedValuesOf === "function"
			? Intl.supportedValuesOf("timeZone")
			: [];
	// `UTC` is a valid zone but is not always listed by `supportedValuesOf`.
	return Array.from(new Set(["UTC", ...zones])).sort();
}

/** A name to the public path segment the schedule accepts. */
export function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

export type WeeklyWindow = {
	weekday: number;
	startMinute: number;
	endMinute: number;
};

function describeWindow(window: WeeklyWindow): string {
	return `${formatMinutes(window.startMinute)}–${formatMinutes(window.endMinute)}`;
}

/**
 * The first pair of windows that share a weekday and overlap. Windows that only
 * touch are fine: 09:00–12:00 and 12:00–17:00 are two windows, not a conflict.
 */
export function findOverlappingWindows(
	windows: WeeklyWindow[],
): [WeeklyWindow, WeeklyWindow] | null {
	for (let weekday = 0; weekday <= 6; weekday++) {
		const day = windows
			.filter((window) => window.weekday === weekday)
			.sort((a, b) => a.startMinute - b.startMinute);
		for (let index = 1; index < day.length; index++) {
			const previous = day[index - 1];
			const current = day[index];
			if (current.startMinute < previous.endMinute) return [previous, current];
		}
	}
	return null;
}

/** One sentence a creator can act on, naming the day and both windows. */
export function describeOverlap(overlap: [WeeklyWindow, WeeklyWindow]): string {
	return `${weekdayName(overlap[0].weekday)} has overlapping windows: ${describeWindow(overlap[0])} and ${describeWindow(overlap[1])}`;
}

type DateTimeParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
};

function partsInZone(date: Date, timeZone: string): DateTimeParts {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).formatToParts(date);
	const read = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((part) => part.type === type)?.value ?? "0");
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		// `hour12: false` can render midnight as 24 in some runtimes.
		hour: read("hour") % 24,
		minute: read("minute"),
	};
}

function utcOffsetMs(date: Date, timeZone: string): number {
	const parts = partsInZone(date, timeZone);
	const asUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
	);
	return asUtc - date.getTime();
}

/**
 * A wall-clock time in `timeZone` as a UTC instant.
 *
 * A zone can be at two different offsets within a day of a transition, so the
 * candidates are built from the offsets a day either side (which straddle a DST
 * change) and the instant whose wall clock reads back exactly is chosen. That
 * makes the normal case exact and a repeated hour (autumn) deterministic: the
 * first occurrence wins.
 *
 * A local time that does not exist (the skipped hour in spring) matches no
 * candidate, so the later candidate is returned, i.e. the first instant after
 * the jump. Nothing is ever invented in the middle of the gap, and no slot is
 * generated twice.
 */
export function zonedTimeToUtc(parts: DateTimeParts, timeZone: string): Date {
	const target = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
	);
	const day = 24 * 60 * 60 * 1000;
	const offsets = new Set<number>();
	for (const probe of [target, target - day, target + day])
		offsets.add(utcOffsetMs(new Date(probe), timeZone));

	const candidates = [...offsets]
		.map((offset) => target - offset)
		.sort((a, b) => a - b);

	for (const candidate of candidates) {
		const reads = partsInZone(new Date(candidate), timeZone);
		if (
			reads.year === parts.year &&
			reads.month === parts.month &&
			reads.day === parts.day &&
			reads.hour === parts.hour &&
			reads.minute === parts.minute
		)
			return new Date(candidate);
	}

	// The wall clock does not exist; shift forward past the gap.
	return new Date(candidates[candidates.length - 1]);
}

/** A UTC instant as the `YYYY-MM-DDTHH:MM` a datetime-local input expects. */
export function utcToZonedInputValue(date: Date, timeZone: string): string {
	const parts = partsInZone(new Date(date), timeZone);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** `YYYY-MM-DDTHH:MM` from a datetime-local input, read in `timeZone`. */
export function zonedInputValueToUtc(
	value: string,
	timeZone: string,
): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
	if (!match) return null;
	const [, year, month, day, hour, minute] = match;
	return zonedTimeToUtc(
		{
			year: Number(year),
			month: Number(month),
			day: Number(day),
			hour: Number(hour),
			minute: Number(minute),
		},
		timeZone,
	);
}

/**
 * How this instant reads in the schedule's zone, so a blocked range is never
 * shown as an opaque UTC timestamp.
 */
export function formatInZone(date: Date, timeZone: string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone,
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(date));
}
