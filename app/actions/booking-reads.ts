"use server";

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/app/db";
import { bookingSchedules, bookings, plans } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { creatorHandle } from "@/lib/services/bookings";

/**
 * Booking read models for the two parties.
 *
 * Kept as an action (not a service) because it is session-scoped and read-only:
 * a customer sees their own bookings, a creator sees bookings on their own
 * schedules, and neither can ask for the other's.
 */

const UPCOMING_STATUSES = ["confirmed"] as const;

/** A customer's own upcoming and past bookings. */
export async function getMyBookings() {
	return authenticatedAction(async (session) => {
		const rows = await db.query.bookings.findMany({
			where: eq(bookings.userId, session.user.id),
			orderBy: [desc(bookings.startsAt)],
			limit: 50,
			columns: {
				id: true,
				startsAt: true,
				endsAt: true,
				status: true,
				chargedCredits: true,
				cancelledAt: true,
			},
			with: {
				schedule: { columns: { name: true, slug: true, timezone: true } },
				creator: { columns: { name: true } },
				plan: { columns: { name: true } },
			},
		});
		return { success: true, data: rows };
	});
}

/**
 * Bookings on a creator's schedules.
 *
 * Includes the customer's name because the creator needs to know who is coming;
 * it deliberately omits their email and anything else not needed to run a
 * session.
 */
export async function getCreatorBookings() {
	return authenticatedAction(async (session) => {
		const rows = await db.query.bookings.findMany({
			where: eq(bookings.creatorId, session.user.id),
			orderBy: [desc(bookings.startsAt)],
			limit: 100,
			columns: {
				id: true,
				startsAt: true,
				endsAt: true,
				status: true,
				chargedCredits: true,
				cancelledAt: true,
			},
			with: {
				schedule: { columns: { name: true, slug: true, timezone: true } },
				customer: { columns: { id: true, name: true, image: true } },
				plan: { columns: { name: true } },
			},
		});
		return { success: true, data: rows };
	});
}

/** A creator's schedules, with the count of confirmed upcoming bookings. */
export async function listCreatorSchedules() {
	return authenticatedAction(async (session) => {
		const schedules = await db.query.bookingSchedules.findMany({
			where: eq(bookingSchedules.creatorId, session.user.id),
			orderBy: [desc(bookingSchedules.createdAt)],
			columns: {
				id: true,
				name: true,
				slug: true,
				description: true,
				durationMinutes: true,
				timezone: true,
				creditsPerBooking: true,
				active: true,
				planId: true,
			},
			with: { plan: { columns: { id: true, name: true } } },
		});
		if (schedules.length === 0) return { success: true, data: [] };

		const upcoming = await db
			.select({
				scheduleId: bookings.scheduleId,
				id: bookings.id,
				startsAt: bookings.startsAt,
			})
			.from(bookings)
			.where(
				and(
					eq(bookings.creatorId, session.user.id),
					inArray(bookings.status, [...UPCOMING_STATUSES]),
					gte(bookings.startsAt, new Date()),
				),
			);
		const counts = new Map<string, number>();
		for (const row of upcoming)
			counts.set(row.scheduleId, (counts.get(row.scheduleId) ?? 0) + 1);

		// The public path needs the creator segment, derived from the owner id so it
		// matches what the booking page resolves against.
		const handle = creatorHandle(session.user.id);
		return {
			success: true,
			data: schedules.map((schedule) => ({
				...schedule,
				creatorHandle: handle,
				upcomingCount: counts.get(schedule.id) ?? 0,
			})),
		};
	});
}

/** Plans a creator could link to a schedule: published, one-time only. */
export async function listBookablePlanOptions() {
	return authenticatedAction(async (session) => {
		const rows = await db.query.plans.findMany({
			where: eq(plans.creatorId, session.user.id),
			orderBy: [desc(plans.createdAt)],
			columns: { id: true, name: true },
			with: {
				versions: {
					where: (version, { eq: equals }) =>
						equals(version.status, "published"),
					columns: { billingMode: true, credits: true },
				},
			},
		});
		return {
			success: true,
			// A monthly plan is excluded up front so the creator is not offered an
			// option the server will refuse.
			data: rows.filter((plan) =>
				plan.versions.some((version) => version.billingMode === "one_time"),
			),
		};
	});
}
