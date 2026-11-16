"use server";

import { revalidatePath } from "next/cache";
import type {
	ExceptionPayload,
	ScheduleSettingsPayload,
	WeeklyWindowPayload,
} from "@/lib/booking-types";
import {
	createSchedule,
	getSchedule,
	listSchedules,
	replaceAvailability,
	replaceExceptions,
	updateSchedule,
} from "@/lib/services/booking-schedules";
import { sessionPrincipal } from "@/lib/services/principal";
import { authenticatedAction } from "@/lib/safe-action";

/**
 * Dashboard transport for booking schedules.
 *
 * Every action authenticates, then calls the creator-scoped service with a
 * session principal, so ownership is enforced once in the service rather than
 * re-checked (and forgotten) at each call site.
 */

const BOOKING_PATHS = ["/dashboard/bookings", "/dashboard/creator"];

function revalidateBookings() {
	for (const path of BOOKING_PATHS) revalidatePath(path);
}

export async function getBookingSchedules() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await listSchedules(sessionPrincipal(session.user.id), {
			limit: 100,
		}),
	}));
}

export async function getBookingSchedule(identifier: string) {
	return authenticatedAction(async (session) => {
		const schedule = await getSchedule(
			sessionPrincipal(session.user.id),
			identifier,
		);
		return { success: true, data: schedule };
	});
}

export async function createBookingScheduleAction(
	input: ScheduleSettingsPayload,
) {
	return authenticatedAction(async (session) => {
		const schedule = await createSchedule(sessionPrincipal(session.user.id), {
			...input,
			description: input.description ?? undefined,
		});
		revalidateBookings();
		return { success: true, data: schedule };
	});
}

/**
 * Save schedule settings. Availability and exceptions are saved separately so
 * an edit to one never silently replaces the other.
 */
export async function updateBookingScheduleAction(
	identifier: string,
	input: ScheduleSettingsPayload,
) {
	return authenticatedAction(async (session) => {
		const schedule = await updateSchedule(
			sessionPrincipal(session.user.id),
			identifier,
			input,
		);
		revalidateBookings();
		return { success: true, data: schedule };
	});
}

/** Replace the whole weekly set; `[]` means "not bookable at all". */
export async function saveBookingAvailabilityAction(
	identifier: string,
	windows: WeeklyWindowPayload[],
) {
	return authenticatedAction(async (session) => {
		const schedule = await replaceAvailability(
			sessionPrincipal(session.user.id),
			identifier,
			windows,
		);
		revalidateBookings();
		return { success: true, data: schedule };
	});
}

/** Replace the whole one-off block list; `[]` clears them. */
export async function saveBookingExceptionsAction(
	identifier: string,
	exceptions: ExceptionPayload[],
) {
	return authenticatedAction(async (session) => {
		const schedule = await replaceExceptions(
			sessionPrincipal(session.user.id),
			identifier,
			exceptions,
		);
		revalidateBookings();
		return { success: true, data: schedule };
	});
}
