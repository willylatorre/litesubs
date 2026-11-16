/**
 * Client-facing shapes for the booking schedule editor.
 *
 * Kept free of server imports so the dashboard can type its props and payloads
 * without importing from a `"use server"` module (which may only export async
 * functions).
 */
import type {
	AvailabilityRow,
	ExceptionRow,
	ScheduleDetail,
} from "@/lib/services/booking-schedules";

export type ScheduleView = ScheduleDetail;
export type AvailabilityView = AvailabilityRow;
export type ExceptionView = ExceptionRow;

export type ScheduleSettingsPayload = {
	name: string;
	slug: string;
	description?: string | null;
	durationMinutes: number;
	bufferBeforeMinutes: number;
	bufferAfterMinutes: number;
	horizonDays: number;
	timezone: string;
	active: boolean;
};

export type WeeklyWindowPayload = {
	weekday: number;
	startMinute: number;
	endMinute: number;
};

export type ExceptionPayload = {
	startsAt: string | Date;
	endsAt: string | Date;
	reason?: string | null;
};
