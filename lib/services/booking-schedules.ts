import { and, asc, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import {
	bookingAvailability,
	bookingExceptions,
	bookingSchedules,
} from "@/app/db/schema";
import {
	describeOverlap,
	findOverlappingWindows,
	isValidTimeZone,
	type WeeklyWindow,
} from "@/lib/booking-time";
import { isSampleScheduleId } from "@/lib/sample-data";
import { type Principal, requireScope, ServiceError } from "./principal";
import { pageInput } from "./plans";

/**
 * Creator-owned booking schedules and the availability behind them.
 *
 * A schedule says *when* someone may book; the linked plan (a later slice) says
 * what a booking costs. Weekly windows are stored as minutes-of-day in the
 * schedule's own timezone so a wall-clock window survives DST instead of
 * drifting an hour twice a year. One-off blocks are stored as UTC instants, so
 * blocking a day never depends on how the zone is currently rendering.
 *
 * Scopes: there is no dedicated booking scope yet, so schedule management uses
 * the plan scopes. Any session or key that already manages plans can manage
 * schedules, and a machine key still cannot touch them (`requireScope` refuses
 * every scope except `credits:consume` for an `apiKey` principal).
 */

export type ScheduleRow = typeof bookingSchedules.$inferSelect;
export type AvailabilityRow = typeof bookingAvailability.$inferSelect;
export type ExceptionRow = typeof bookingExceptions.$inferSelect;

export type ScheduleDetail = ScheduleRow & {
	availability: AvailabilityRow[];
	exceptions: ExceptionRow[];
	/**
	 * True for the deterministic `sample-schedule-*` demo row. The UI labels it
	 * and the service refuses to mutate it, so real edits never rewrite the demo.
	 */
	isSample: boolean;
};

export type WeeklyWindowInput = WeeklyWindow;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const timeZoneSchema = z
	.string()
	.trim()
	.min(1, "A schedule needs a timezone")
	.max(64)
	.refine(isValidTimeZone, {
		message:
			"Enter a real IANA timezone, for example America/New_York or Europe/London",
	});

const weeklyWindowSchema = z
	.object({
		weekday: z.coerce
			.number()
			.int()
			.min(0, "Weekday must be between Sunday (0) and Saturday (6)")
			.max(6, "Weekday must be between Sunday (0) and Saturday (6)"),
		startMinute: z.coerce
			.number()
			.int()
			.min(0, "A window cannot start before 00:00")
			.max(1440, "A window cannot start after 24:00"),
		endMinute: z.coerce
			.number()
			.int()
			.min(0, "A window cannot end before 00:00")
			.max(1440, "A window cannot end after 24:00"),
	})
	.superRefine((window, ctx) => {
		if (window.endMinute <= window.startMinute)
			ctx.addIssue({
				code: "custom",
				path: ["endMinute"],
				message: "A weekly window must end after it starts",
			});
	});

/**
 * A full set of windows, validated as a set. Overlap is rejected rather than
 * merged: two overlapping windows make a slot's availability ambiguous, and the
 * creator should decide what they actually meant.
 */
export const availabilitySchema = z
	.array(weeklyWindowSchema)
	.max(100, "That is more windows than a week can hold")
	.superRefine((windows, ctx) => {
		const overlap = findOverlappingWindows(windows);
		if (!overlap) return;
		ctx.addIssue({
			code: "custom",
			path: [],
			message: describeOverlap(overlap),
		});
	});

const exceptionSchema = z
	.object({
		startsAt: z.coerce.date(),
		endsAt: z.coerce.date(),
		reason: z.string().trim().max(500).nullish(),
	})
	.superRefine((exception, ctx) => {
		if (Number.isNaN(exception.startsAt.getTime()))
			ctx.addIssue({
				code: "custom",
				path: ["startsAt"],
				message: "The block needs a valid start",
			});
		if (Number.isNaN(exception.endsAt.getTime()))
			ctx.addIssue({
				code: "custom",
				path: ["endsAt"],
				message: "The block needs a valid end",
			});
		if (exception.endsAt.getTime() <= exception.startsAt.getTime())
			ctx.addIssue({
				code: "custom",
				path: ["endsAt"],
				message: "The block must end after it starts",
			});
	});

export const exceptionsSchema = z
	.array(exceptionSchema)
	.max(200, "That is more one-off blocks than belong on one schedule");

const scheduleFields = {
	name: z.string().trim().min(1, "A schedule needs a name").max(120),
	slug: z
		.string()
		.trim()
		.min(1, "A schedule needs a link")
		.max(64)
		.regex(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			"Use lowercase letters, numbers, and single dashes",
		),
	description: z.string().trim().max(2000).optional(),
	durationMinutes: z.coerce
		.number()
		.int()
		.min(1, "A booking must last at least one minute")
		.max(1440, "A booking cannot last longer than a day"),
	bufferBeforeMinutes: z.coerce
		.number()
		.int()
		.min(0, "Buffers cannot be negative")
		.max(1440, "A buffer cannot be longer than a day"),
	bufferAfterMinutes: z.coerce
		.number()
		.int()
		.min(0, "Buffers cannot be negative")
		.max(1440, "A buffer cannot be longer than a day"),
	horizonDays: z.coerce
		.number()
		.int()
		.min(1, "The booking horizon must be at least one day")
		.max(365, "Keep the booking horizon within a year"),
	timezone: timeZoneSchema,
	active: z.boolean(),
};

export const createScheduleSchema = z.object({
	...scheduleFields,
	active: scheduleFields.active.default(true),
	/** Optional so a creator can create the shell first and paint windows after. */
	availability: availabilitySchema.optional(),
	exceptions: exceptionsSchema.optional(),
});

export const updateScheduleSchema = z
	.object({
		name: scheduleFields.name.optional(),
		slug: scheduleFields.slug.optional(),
		description: scheduleFields.description.nullable(),
		durationMinutes: scheduleFields.durationMinutes.optional(),
		bufferBeforeMinutes: scheduleFields.bufferBeforeMinutes.optional(),
		bufferAfterMinutes: scheduleFields.bufferAfterMinutes.optional(),
		horizonDays: scheduleFields.horizonDays.optional(),
		timezone: scheduleFields.timezone.optional(),
		active: scheduleFields.active.optional(),
		availability: availabilitySchema.optional(),
		exceptions: exceptionsSchema.optional(),
	})
	.refine(
		(data) => Object.values(data).some((value) => value !== undefined),
		"Provide at least one field to update",
	);

/**
 * Turn a Zod failure into the same `ServiceError` shape as every other refusal,
 * so the dashboard gets one clear sentence instead of a serialized issue list.
 */
function parseInput<T extends z.ZodType>(
	schema: T,
	input: unknown,
): z.infer<T> {
	const result = schema.safeParse(input);
	if (result.success) return result.data;
	const [issue] = result.error.issues;
	throw new ServiceError(
		"INVALID_INPUT",
		issue?.message ?? "Invalid input",
		400,
		result.error.flatten().fieldErrors,
	);
}

// ---------------------------------------------------------------------------
// Ownership and sample data
// ---------------------------------------------------------------------------

/**
 * Sample rows use deterministic IDs derived from the creator (`sample-…`), the
 * same convention as the sample plan and customer. They exist to show a filled-in
 * screen, so a real edit must never rewrite the demo underneath the creator.
 * The predicate itself lives in `lib/sample-data.ts` so the dashboard labels
 * rows with exactly the rule the service enforces.
 */
function assertEditable(schedule: ScheduleRow) {
	if (isSampleScheduleId(schedule.id))
		throw new ServiceError(
			"SAMPLE_IMMUTABLE",
			"This is the sample schedule. Real edits never change sample data.",
			409,
		);
}

/**
 * Exact ID or public slug, always within the caller's own schedules. A creator
 * must never reach another creator's schedule by guessing its ID.
 */
export async function resolveSchedule(
	principal: Principal,
	identifier: string,
	client: Pick<typeof db, "query"> = db,
) {
	const matches = await client.query.bookingSchedules.findMany({
		where: and(
			eq(bookingSchedules.creatorId, principal.creatorId),
			or(
				eq(bookingSchedules.id, identifier),
				eq(bookingSchedules.slug, identifier.trim().toLowerCase()),
			),
		),
	});
	if (!matches.length)
		throw new ServiceError("NOT_FOUND", "Booking schedule not found", 404);
	if (matches.length > 1)
		throw new ServiceError(
			"AMBIGUOUS",
			"More than one schedule matches; use its ID",
			409,
		);
	return matches[0];
}

async function readDetail(
	schedule: ScheduleRow,
	client: Pick<typeof db, "query"> = db,
): Promise<ScheduleDetail> {
	const [availability, exceptions] = await Promise.all([
		client.query.bookingAvailability.findMany({
			where: and(
				eq(bookingAvailability.scheduleId, schedule.id),
				eq(bookingAvailability.creatorId, schedule.creatorId),
			),
			orderBy: [
				asc(bookingAvailability.weekday),
				asc(bookingAvailability.startMinute),
			],
		}),
		client.query.bookingExceptions.findMany({
			where: and(
				eq(bookingExceptions.scheduleId, schedule.id),
				eq(bookingExceptions.creatorId, schedule.creatorId),
			),
			orderBy: [asc(bookingExceptions.startsAt)],
		}),
	]);
	return {
		...schedule,
		availability,
		exceptions,
		isSample: isSampleScheduleId(schedule.id),
	};
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listSchedules(
	principal: Principal,
	input: unknown = {},
): Promise<ScheduleDetail[]> {
	requireScope(principal, "plans:read");
	const page = parseInput(pageInput, input);
	const rows = await db.query.bookingSchedules.findMany({
		where: eq(bookingSchedules.creatorId, principal.creatorId),
		orderBy: [desc(bookingSchedules.createdAt), desc(bookingSchedules.id)],
		...page,
	});
	return Promise.all(rows.map((row) => readDetail(row)));
}

export async function getSchedule(
	principal: Principal,
	identifier: string,
): Promise<ScheduleDetail> {
	requireScope(principal, "plans:read");
	const schedule = await resolveSchedule(principal, identifier);
	return readDetail(schedule);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Two schedules of one creator cannot share a slug: the slug is the public
 * `/book/...` address, so a duplicate would make the address ambiguous.
 */
async function assertSlugAvailable(
	creatorId: string,
	slug: string,
	exceptId?: string,
) {
	const existing = await db.query.bookingSchedules.findFirst({
		where: and(
			eq(bookingSchedules.creatorId, creatorId),
			eq(bookingSchedules.slug, slug),
		),
	});
	if (existing && existing.id !== exceptId)
		throw new ServiceError(
			"SLUG_TAKEN",
			`You already have a schedule at /book/${slug}`,
			409,
		);
}

/** A unique-constraint race can still slip past the check above. */
function rethrowConflict(error: unknown): never {
	const code =
		typeof error === "object" && error && "code" in error
			? (error as { code?: string }).code
			: undefined;
	if (code === "23505")
		throw new ServiceError(
			"SLUG_TAKEN",
			"You already have a schedule with that link",
			409,
		);
	throw error;
}

export async function createSchedule(
	principal: Principal,
	input: unknown,
): Promise<ScheduleDetail> {
	requireScope(principal, "plans:write");
	const data = parseInput(createScheduleSchema, input);
	await assertSlugAvailable(principal.creatorId, data.slug);

	try {
		return await db.transaction(async (tx) => {
			const [schedule] = await tx
				.insert(bookingSchedules)
				.values({
					creatorId: principal.creatorId,
					name: data.name,
					slug: data.slug,
					description: data.description,
					durationMinutes: data.durationMinutes,
					bufferBeforeMinutes: data.bufferBeforeMinutes,
					bufferAfterMinutes: data.bufferAfterMinutes,
					horizonDays: data.horizonDays,
					timezone: data.timezone,
					active: data.active,
				})
				.returning();
			if (data.availability?.length)
				await insertAvailability(tx, schedule, data.availability);
			if (data.exceptions?.length)
				await insertExceptions(tx, schedule, data.exceptions);
			return readDetail(schedule, tx);
		});
	} catch (error) {
		rethrowConflict(error);
	}
}

export async function updateSchedule(
	principal: Principal,
	identifier: string,
	input: unknown,
): Promise<ScheduleDetail> {
	requireScope(principal, "plans:write");
	const data = parseInput(updateScheduleSchema, input);
	const schedule = await resolveSchedule(principal, identifier);
	assertEditable(schedule);
	if (data.slug !== undefined)
		await assertSlugAvailable(principal.creatorId, data.slug, schedule.id);

	const settings = {
		...(data.name === undefined ? {} : { name: data.name }),
		...(data.slug === undefined ? {} : { slug: data.slug }),
		...(data.description === undefined
			? {}
			: { description: data.description }),
		...(data.durationMinutes === undefined
			? {}
			: { durationMinutes: data.durationMinutes }),
		...(data.bufferBeforeMinutes === undefined
			? {}
			: { bufferBeforeMinutes: data.bufferBeforeMinutes }),
		...(data.bufferAfterMinutes === undefined
			? {}
			: { bufferAfterMinutes: data.bufferAfterMinutes }),
		...(data.horizonDays === undefined
			? {}
			: { horizonDays: data.horizonDays }),
		// Changing the timezone changes how the *weekly windows* are read. A
		// booking already sold keeps the UTC instants it was written with,
		// because nothing here touches the `bookings` table.
		...(data.timezone === undefined ? {} : { timezone: data.timezone }),
		...(data.active === undefined ? {} : { active: data.active }),
	};

	try {
		return await db.transaction(async (tx) => {
			if (Object.keys(settings).length > 0) {
				await tx
					.update(bookingSchedules)
					.set(settings)
					.where(
						and(
							eq(bookingSchedules.id, schedule.id),
							eq(bookingSchedules.creatorId, principal.creatorId),
						),
					);
			}
			if (data.availability !== undefined)
				await replaceAvailabilityRows(tx, schedule, data.availability);
			if (data.exceptions !== undefined)
				await replaceExceptionRows(tx, schedule, data.exceptions);
			const [updated] = await tx
				.select()
				.from(bookingSchedules)
				.where(
					and(
						eq(bookingSchedules.id, schedule.id),
						eq(bookingSchedules.creatorId, principal.creatorId),
					),
				);
			return readDetail(updated, tx);
		});
	} catch (error) {
		rethrowConflict(error);
	}
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
function availabilityValues(
	schedule: ScheduleRow,
	windows: WeeklyWindowInput[],
) {
	return windows.map((window) => ({
		scheduleId: schedule.id,
		creatorId: schedule.creatorId,
		weekday: window.weekday,
		startMinute: window.startMinute,
		endMinute: window.endMinute,
	}));
}

async function insertAvailability(
	tx: Transaction,
	schedule: ScheduleRow,
	windows: WeeklyWindowInput[],
) {
	await tx
		.insert(bookingAvailability)
		.values(availabilityValues(schedule, windows));
}

async function replaceAvailabilityRows(
	tx: Transaction,
	schedule: ScheduleRow,
	windows: WeeklyWindowInput[],
) {
	// Replace-as-a-set: a partial update could leave two windows overlapping,
	// which both this service and the booking read path treat as invalid.
	await tx
		.delete(bookingAvailability)
		.where(
			and(
				eq(bookingAvailability.scheduleId, schedule.id),
				eq(bookingAvailability.creatorId, schedule.creatorId),
			),
		);
	if (windows.length) await insertAvailability(tx, schedule, windows);
}

type ExceptionInput = { startsAt: Date; endsAt: Date; reason?: string | null };

async function insertExceptions(
	tx: Transaction,
	schedule: ScheduleRow,
	exceptions: ExceptionInput[],
) {
	await tx.insert(bookingExceptions).values(
		exceptions.map((exception) => ({
			scheduleId: schedule.id,
			creatorId: schedule.creatorId,
			startsAt: exception.startsAt,
			endsAt: exception.endsAt,
			reason: exception.reason ?? null,
		})),
	);
}

async function replaceExceptionRows(
	tx: Transaction,
	schedule: ScheduleRow,
	exceptions: ExceptionInput[],
) {
	await tx
		.delete(bookingExceptions)
		.where(
			and(
				eq(bookingExceptions.scheduleId, schedule.id),
				eq(bookingExceptions.creatorId, schedule.creatorId),
			),
		);
	if (exceptions.length) await insertExceptions(tx, schedule, exceptions);
}

/** Replace the whole weekly set. `[]` clears availability (nothing bookable). */
export async function replaceAvailability(
	principal: Principal,
	identifier: string,
	input: unknown,
): Promise<ScheduleDetail> {
	requireScope(principal, "plans:write");
	// Ownership is checked before the payload: another creator's schedule must
	// report "not found" whatever the input says, so its existence never leaks.
	const schedule = await resolveSchedule(principal, identifier);
	assertEditable(schedule);
	const windows = parseInput(availabilitySchema, input);
	return db.transaction(async (tx) => {
		await replaceAvailabilityRows(tx, schedule, windows);
		return readDetail(schedule, tx);
	});
}

/** Replace the whole one-off block list. `[]` clears them. */
export async function replaceExceptions(
	principal: Principal,
	identifier: string,
	input: unknown,
): Promise<ScheduleDetail> {
	requireScope(principal, "plans:write");
	const exceptions = parseInput(exceptionsSchema, input);
	const schedule = await resolveSchedule(principal, identifier);
	assertEditable(schedule);
	return db.transaction(async (tx) => {
		await replaceExceptionRows(tx, schedule, exceptions);
		return readDetail(schedule, tx);
	});
}
