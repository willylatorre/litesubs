import { and, eq } from "drizzle-orm";
import type { db } from "@/app/db";
import { bookingAvailability, bookingSchedules } from "@/app/db/schema";
import { SAMPLE_SCHEDULE, sampleIds } from "@/lib/sample-data";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Client = Transaction | typeof db;

/**
 * Seed the demo schedule shown on the bookings screen.
 *
 * It is a normal row with deterministic `sample-*` IDs, exactly like the sample
 * plan and customer: the service refuses to edit it, and removal can target it
 * precisely. Idempotent, so loading the sample workspace twice is harmless.
 */
export async function seedSampleSchedule(
	client: Client,
	creatorId: string,
): Promise<void> {
	const ids = sampleIds(creatorId);
	await client
		.insert(bookingSchedules)
		.values({
			id: ids.schedule,
			creatorId,
			name: SAMPLE_SCHEDULE.name,
			slug: SAMPLE_SCHEDULE.slug,
			description: SAMPLE_SCHEDULE.description,
			durationMinutes: SAMPLE_SCHEDULE.durationMinutes,
			bufferBeforeMinutes: SAMPLE_SCHEDULE.bufferBeforeMinutes,
			bufferAfterMinutes: SAMPLE_SCHEDULE.bufferAfterMinutes,
			horizonDays: SAMPLE_SCHEDULE.horizonDays,
			timezone: SAMPLE_SCHEDULE.timezone,
			active: SAMPLE_SCHEDULE.active,
		})
		.onConflictDoNothing({ target: bookingSchedules.id });

	await client
		.insert(bookingAvailability)
		.values(
			SAMPLE_SCHEDULE.weekdays.map((weekday) => ({
				id: `${ids.scheduleAvailability}-${weekday}`,
				scheduleId: ids.schedule,
				creatorId,
				weekday,
				startMinute: SAMPLE_SCHEDULE.startMinute,
				endMinute: SAMPLE_SCHEDULE.endMinute,
			})),
		)
		.onConflictDoNothing({ target: bookingAvailability.id });
}

/**
 * Remove only the demo schedule. Rows are matched by both the deterministic ID
 * and the creator, so a real schedule can never be caught by this delete.
 */
export async function removeSampleSchedule(
	client: Client,
	creatorId: string,
): Promise<void> {
	const ids = sampleIds(creatorId);
	await client
		.delete(bookingAvailability)
		.where(
			and(
				eq(bookingAvailability.creatorId, creatorId),
				eq(bookingAvailability.scheduleId, ids.schedule),
			),
		);
	await client
		.delete(bookingSchedules)
		.where(
			and(
				eq(bookingSchedules.creatorId, creatorId),
				eq(bookingSchedules.id, ids.schedule),
			),
		);
}
