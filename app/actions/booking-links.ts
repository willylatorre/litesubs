"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/app/db";
import { bookingSchedules, bookings, plans } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { ServiceError } from "@/lib/services/principal";

/**
 * Plan ↔ schedule linking (B3).
 *
 * A schedule references one plan; the link is the only thing that decides which
 * credits a booking spends. It is deliberately editable from both the plan view
 * and the schedule view so the two can never tell different stories.
 *
 * Rules enforced here, not in the UI:
 * - Both sides must belong to the signed-in creator.
 * - A recurring plan is refused: a booking is not a billing period.
 * - A price must be a whole number above zero. A null price is not a free
 *   booking; it unlinks the plan, because a schedule with no price would sell
 *   the creator's time for nothing.
 */

const linkInput = z.object({
	scheduleId: z.string().trim().min(1).max(200),
	/** Null unlinks, which disables new bookings without deleting history. */
	planId: z.string().trim().min(1).max(200).nullable(),
	creditsPerBooking: z
		.number()
		.int()
		.min(1)
		.max(1_000_000)
		.nullable()
		.optional(),
});

export async function linkScheduleToPlan(input: {
	scheduleId: string;
	planId: string | null;
	creditsPerBooking?: number | null;
}) {
	return authenticatedAction(async (session) => {
		try {
			const data = linkInput.parse(input);
			const schedule = await db.query.bookingSchedules.findFirst({
				where: and(
					eq(bookingSchedules.id, data.scheduleId),
					eq(bookingSchedules.creatorId, session.user.id),
				),
				columns: { id: true, planId: true },
			});
			if (!schedule)
				throw new ServiceError("NOT_FOUND", "Schedule not found", 404);

			if (data.planId) {
				const plan = await db.query.plans.findFirst({
					where: and(
						eq(plans.id, data.planId),
						eq(plans.creatorId, session.user.id),
					),
					with: {
						versions: {
							where: (version, { eq: equals }) =>
								equals(version.status, "published"),
						},
					},
				});
				if (!plan) throw new ServiceError("NOT_FOUND", "Plan not found", 404);
				// A booking spends one allowance, never a billing period.
				if (
					plan.versions.some((version) => version.billingMode === "recurring")
				)
					throw new ServiceError(
						"PLAN_NOT_BOOKABLE",
						"A monthly plan cannot be booked. Link a one-time plan instead.",
						409,
					);
				// Linking without a price would silently make every booking free.
				if (data.creditsPerBooking === null)
					throw new ServiceError(
						"PRICE_REQUIRED",
						"Set how many credits a booking spends when linking a plan",
					);
			}

			await db
				.update(bookingSchedules)
				.set({
					planId: data.planId,
					creditsPerBooking:
						data.planId === null ? null : (data.creditsPerBooking ?? undefined),
				})
				.where(eq(bookingSchedules.id, schedule.id));

			revalidatePath("/dashboard/plans");
			revalidatePath("/dashboard/bookings");
			return { success: true };
		} catch (error) {
			if (error instanceof z.ZodError)
				return { success: false, error: "Invalid link request" };
			return {
				success: false,
				error:
					error instanceof ServiceError
						? error.message
						: "Could not link the schedule",
				code: error instanceof ServiceError ? error.code : undefined,
			};
		}
	});
}

/** The schedules the creator could attach to a plan, for the plan view. */
export async function listSchedulesForPlan(planId: string) {
	return authenticatedAction(async (session) => {
		const plan = await db.query.plans.findFirst({
			where: and(eq(plans.id, planId), eq(plans.creatorId, session.user.id)),
			columns: { id: true },
		});
		if (!plan) return { success: false, error: "Plan not found" };

		const schedules = await db.query.bookingSchedules.findMany({
			where: eq(bookingSchedules.creatorId, session.user.id),
			orderBy: [desc(bookingSchedules.createdAt)],
			columns: {
				id: true,
				name: true,
				slug: true,
				planId: true,
				creditsPerBooking: true,
				durationMinutes: true,
				active: true,
			},
		});
		// Schedules already pointing at another plan are shown so the creator can
		// see why a plan has no schedule, rather than silently hiding them.
		return {
			success: true,
			data: schedules.map((schedule) => ({
				...schedule,
				creatorUsername: session.user.username ?? null,
				linkedHere: schedule.planId === planId,
			})),
		};
	});
}

/** A schedule's linked plan, for the booking-schedule editor. */
export async function getSchedulePlanLink(scheduleId: string) {
	return authenticatedAction(async (session) => {
		const schedule = await db.query.bookingSchedules.findFirst({
			where: and(
				eq(bookingSchedules.id, scheduleId),
				eq(bookingSchedules.creatorId, session.user.id),
			),
			columns: {
				id: true,
				name: true,
				slug: true,
				planId: true,
				creditsPerBooking: true,
				durationMinutes: true,
				timezone: true,
			},
			with: { plan: { columns: { id: true, name: true } } },
		});
		if (!schedule) return { success: false, error: "Schedule not found" };
		// A confirmed booking outlives an unlink, so the editor warns before one.
		const confirmed = await db.query.bookings.findFirst({
			where: and(
				eq(bookings.scheduleId, scheduleId),
				eq(bookings.status, "confirmed"),
			),
			columns: { id: true },
		});
		return {
			success: true,
			data: { ...schedule, hasConfirmedBookings: Boolean(confirmed) },
		};
	});
}
