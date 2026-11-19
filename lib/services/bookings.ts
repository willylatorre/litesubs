import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import {
	bookingAvailability,
	bookingExceptions,
	bookingSchedules,
	bookings,
	creditAllocations,
	creditGrants,
	enrollments,
	plans,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import {
	generateSlots,
	isSlotBookable,
	type SlotInput,
} from "@/lib/booking-slots";
import {
	bestEffortCreateBookingEvent,
	bestEffortDeleteBookingEvent,
	filterSlotsByCalendar,
} from "@/lib/google-calendar";
import { usableBalance } from "./credit-balance";
import { adjustCredits } from "./credits";
import {
	notifyBookingCancelled,
	notifyBookingConfirmed,
} from "./notifications";
import {
	type Principal,
	requireScope,
	ServiceError,
	systemPrincipal,
} from "./principal";

/**
 * Native bookings.
 *
 * A booking is a time slot plus a credit debit. Scheduling rules live in
 * `lib/booking-slots.ts` (pure, timezone-tested); the money rules live in
 * `lib/services/credits.ts`. This service connects them and owns the one thing
 * neither can: the transaction that must not half-succeed.
 *
 * Deliberate choices:
 *
 * - The customer's principal is required, and the plan is resolved from the
 *   *schedule*, never from client input. A booking request cannot choose which
 *   plan to spend from.
 * - The debit runs through `adjustCredits`, so allocation, overdraft protection,
 *   and expiry are not reimplemented here. Its idempotency key is derived from
 *   the booking id, so a retried request cannot double-spend.
 * - Overlap is enforced by the database exclusion constraint, not by this code.
 *   The pre-check below only produces a friendlier error; correctness is the
 *   constraint's job.
 * - Cancelling restores units to the grants they came from. Expired or already
 *   re-spent units are gone, so book/cancel cannot mint credits.
 */

const slotInputBase = z.object({
	scheduleId: z.string().trim().min(1).max(200),
	/** ISO instant of the slot start the customer chose. */
	startsAt: z.iso.datetime(),
});

export type PublicSchedule = {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	durationMinutes: number;
	timezone: string;
	creditsPerBooking: number | null;
	plan: { id: string; name: string; currency: string; price: number } | null;
};

/** The creator's view: includes what is needed to edit, never another tenant's. */
export async function getScheduleForCreator(
	principal: Principal,
	scheduleId: string,
) {
	requireScope(principal, "plans:read");
	const schedule = await db.query.bookingSchedules.findFirst({
		where: and(
			eq(bookingSchedules.id, scheduleId),
			eq(bookingSchedules.creatorId, principal.creatorId),
		),
		with: { plan: { with: { versions: true } } },
	});
	if (!schedule) throw new ServiceError("NOT_FOUND", "Schedule not found", 404);
	return schedule;
}

/**
 * Public schedules are addressed by `(username, slug)`, not by slug alone.
 *
 * The unique constraint is per creator, so two creators may both own
 * `office-hours`. Resolving by slug only would silently serve whichever row the
 * database returned first, which is a data-leak and a wrong-debit risk at once.
 * Twelve-character account handles remain readable for pre-username links; new
 * usernames cannot take that reserved length. Better Auth ids are not always
 * UUIDs, so legacy handles are not necessarily hexadecimal.
 */
export async function resolvePublicSchedule(
	username: string,
	slug: string,
): Promise<{
	schedule: PublicSchedule & {
		creatorId: string;
		creatorName: string;
		creatorUsername: string | null;
	};
} | null> {
	const identities = [eq(user.username, username.toLowerCase())];
	if (username.length === 12) {
		identities.push(
			sql`substring(replace(${user.id}, '-', '') from 1 for 12) = ${username}`,
		);
	}

	const [row] = await db
		.select({
			id: bookingSchedules.id,
			name: bookingSchedules.name,
			slug: bookingSchedules.slug,
			description: bookingSchedules.description,
			durationMinutes: bookingSchedules.durationMinutes,
			timezone: bookingSchedules.timezone,
			creditsPerBooking: bookingSchedules.creditsPerBooking,
			active: bookingSchedules.active,
			creatorId: bookingSchedules.creatorId,
			creatorName: user.name,
			creatorUsername: user.username,
			planId: plans.id,
			planName: plans.name,
			planDescription: plans.description,
		})
		.from(bookingSchedules)
		.innerJoin(user, eq(user.id, bookingSchedules.creatorId))
		.leftJoin(plans, eq(plans.id, bookingSchedules.planId))
		.where(and(eq(bookingSchedules.slug, slug), or(...identities)))
		.limit(1);
	if (!row?.active) return null;

	let plan: PublicSchedule["plan"] = null;
	if (row.planId) {
		const version = await db.query.planVersions.findFirst({
			where: and(
				eq(planVersions.planId, row.planId),
				eq(planVersions.status, "published"),
			),
			columns: { currency: true, price: true },
		});
		plan = {
			id: row.planId,
			name: row.planName ?? "",
			currency: version?.currency ?? "usd",
			price: version?.price ?? 0,
		};
	}

	return {
		schedule: {
			id: row.id,
			name: row.name,
			slug: row.slug,
			description: row.description,
			durationMinutes: row.durationMinutes,
			timezone: row.timezone,
			creditsPerBooking: row.creditsPerBooking,
			plan,
			creatorId: row.creatorId,
			creatorName: row.creatorName ?? "",
			creatorUsername: row.creatorUsername,
		},
	};
}

/** The scheduling inputs for slot math, read from the database. */
async function slotInputForSchedule(
	scheduleId: string,
	creatorId: string,
	now = new Date(),
): Promise<SlotInput & { schedule: typeof bookingSchedules.$inferSelect }> {
	const schedule = await db.query.bookingSchedules.findFirst({
		where: and(
			eq(bookingSchedules.id, scheduleId),
			eq(bookingSchedules.creatorId, creatorId),
		),
	});
	if (!schedule) throw new ServiceError("NOT_FOUND", "Schedule not found", 404);

	const [availability, exceptions, confirmed] = await Promise.all([
		db.query.bookingAvailability.findMany({
			where: eq(bookingAvailability.scheduleId, scheduleId),
			columns: { weekday: true, startMinute: true, endMinute: true },
		}),
		db.query.bookingExceptions.findMany({
			where: eq(bookingExceptions.scheduleId, scheduleId),
			columns: { startsAt: true, endsAt: true },
		}),
		db.query.bookings.findMany({
			where: and(
				eq(bookings.scheduleId, scheduleId),
				eq(bookings.status, "confirmed"),
			),
			columns: { startsAt: true, endsAt: true },
		}),
	]);

	return {
		schedule,
		durationMinutes: schedule.durationMinutes,
		bufferBeforeMinutes: schedule.bufferBeforeMinutes,
		bufferAfterMinutes: schedule.bufferAfterMinutes,
		horizonDays: schedule.horizonDays,
		timeZone: schedule.timezone,
		availability,
		exceptions: exceptions.map((row) => ({
			start: row.startsAt,
			end: row.endsAt,
		})),
		bookings: confirmed.map((row) => ({
			start: row.startsAt,
			end: row.endsAt,
		})),
		now,
	};
}

/** Open slots for a public schedule, computed on read. No cron, no caching. */
export async function listOpenSlots(username: string, slug: string) {
	const resolved = await resolvePublicSchedule(username, slug);
	if (!resolved) return { schedule: null, slots: [] };
	const input = await slotInputForSchedule(
		resolved.schedule.id,
		resolved.schedule.creatorId,
	);
	const { schedule: _schedule, ...slotInput } = input;
	const generated = generateSlots(slotInput);

	// The creator's external calendar can only REMOVE slots. This is best-effort:
	// if Google is unreachable the native availability still stands, because a
	// calendar problem must never take a bookable page offline.
	const calendarFiltered =
		generated.length > 0
			? await filterSlotsByCalendar(resolved.schedule.creatorId, generated, {
					from: generated[0].start,
					to: generated[generated.length - 1].end,
				})
			: generated;

	return {
		schedule: resolved.schedule,
		// `slotInputForSchedule` also returns the schedule row; slot math only
		// needs the timing fields.
		slots: calendarFiltered.map((slot) => ({
			start: slot.start.toISOString(),
			end: slot.end.toISOString(),
		})),
	};
}

export type CreateBookingResult = {
	bookingId: string;
	scheduleId: string;
	startsAt: string;
	endsAt: string;
	chargedCredits: number;
	balance: number;
};

/**
 * Book a slot for the signed-in customer.
 *
 * The schedule, plan, price, and enrollment are all resolved server-side. The
 * client contributes exactly one thing it is allowed to choose: a start time,
 * which is re-validated against the same rules the page used.
 */
export async function createBooking(
	principal: Principal,
	input: unknown,
): Promise<CreateBookingResult> {
	const data = slotInputBase.parse(input);

	const schedule = await db.query.bookingSchedules.findFirst({
		where: eq(bookingSchedules.id, data.scheduleId),
		columns: {
			id: true,
			name: true,
			creatorId: true,
			planId: true,
			creditsPerBooking: true,
			active: true,
			timezone: true,
		},
	});
	if (!schedule?.active)
		throw new ServiceError("NOT_BOOKABLE", "This schedule is not open", 404);
	if (schedule.creatorId === principal.creatorId)
		throw new ServiceError(
			"INVALID_INPUT",
			"Creators cannot book their own schedule",
		);

	// The buyer is the signed-in user. A creator-side principal is not a
	// customer, so the booking is attributed to the session's own user id.
	const userId = principal.userId;
	if (!userId)
		throw new ServiceError(
			"SIGN_IN_REQUIRED",
			"Sign in to book and spend credits",
			401,
		);

	if (!schedule.planId || !schedule.creditsPerBooking)
		throw new ServiceError(
			"NOT_BOOKABLE",
			"This schedule is not linked to a plan with a credit price",
			409,
		);

	// A booking is not a billing period, so a monthly plan cannot be its target.
	const version = await db.query.planVersions.findFirst({
		where: and(
			eq(planVersions.planId, schedule.planId),
			eq(planVersions.status, "published"),
		),
		columns: { id: true, billingMode: true },
	});
	if (!version)
		throw new ServiceError(
			"NOT_BOOKABLE",
			"The linked plan is not published, so bookings cannot spend its credits",
			409,
		);
	if (version.billingMode === "recurring")
		throw new ServiceError(
			"NOT_BOOKABLE",
			"A monthly plan cannot be booked: a booking is not a billing period",
			409,
		);

	const enrollment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, userId),
			eq(enrollments.planId, schedule.planId),
		),
		columns: { id: true },
	});
	if (!enrollment)
		throw new ServiceError(
			"NOT_ENROLLED",
			"You do not have this plan, so there are no credits to spend",
			409,
		);

	const start = new Date(data.startsAt);
	const slotInput = await slotInputForSchedule(schedule.id, schedule.creatorId);
	const slot = isSlotBookable(slotInput, start);
	if (!slot)
		throw new ServiceError(
			"SLOT_UNAVAILABLE",
			"That time is not available any more. Pick another slot.",
			409,
		);

	// The page filtered by the external calendar when it rendered, but a stale
	// page could still submit a slot the creator became busy for since. Re-check
	// the one chosen slot. A calendar failure degrades to "allow", because a
	// Google outage must not stop the business from taking bookings.
	const stillFree = await filterSlotsByCalendar(schedule.creatorId, [slot], {
		from: slot.start,
		to: slot.end,
	});
	if (stillFree.length === 0)
		throw new ServiceError(
			"SLOT_UNAVAILABLE",
			"That time is no longer available on the creator's calendar.",
			409,
		);

	const bookingId = crypto.randomUUID();
	const end = slot.end;

	try {
		// One transaction: the booking row and the debit succeed or fail together,
		// so a refused debit cannot leave a confirmed reservation behind.
		const created = await db.transaction(async (tx) => {
			// Insert first: the exclusion constraint rejects an overlap here, which
			// is the only double-booking defense that holds under concurrency.
			await tx.insert(bookings).values({
				id: bookingId,
				scheduleId: schedule.id,
				creatorId: schedule.creatorId,
				userId,
				planId: schedule.planId,
				startsAt: slot.start,
				endsAt: end,
				status: "confirmed",
				chargedCredits: schedule.creditsPerBooking as number,
			});

			// The caller is a customer session, which by policy cannot consume
			// credits; the booking is an internal, already-validated debit on the
			// creator's plan, so it acts with explicit system authority scoped to
			// that creator rather than widening the public gate.
			const charge = await adjustCredits(systemPrincipal(schedule.creatorId), {
				customerId: userId,
				planId: schedule.planId as string,
				delta: -(schedule.creditsPerBooking as number),
				type: "usage",
				reason: `Booking ${bookingId}`,
				// Derived from the booking, so a retried request replays the debit
				// instead of charging twice.
				key: `booking:${bookingId}`,
			});

			const balance = await usableBalance(tx, enrollment.id);
			await tx
				.update(bookings)
				.set({ chargeTransactionId: charge.transactionId })
				.where(eq(bookings.id, bookingId));

			return {
				bookingId,
				scheduleId: schedule.id,
				startsAt: slot.start.toISOString(),
				endsAt: end.toISOString(),
				chargedCredits: schedule.creditsPerBooking as number,
				balance,
			};
		});

		// Notifications run strictly after the booking and its debit committed.
		// They cannot throw (the service guarantees it), and a failure here must
		// never make a real booking look failed to the customer.
		// Mirror the booking onto the creator's calendar, best-effort and after
		// commit. The event id is persisted so cancellation can remove it; without
		// that the event would be orphaned on the calendar forever.
		const createdEvent = await bestEffortCreateBookingEvent(
			schedule.creatorId,
			{
				bookingId: created.bookingId,
				summary: `Booking: ${schedule.name}`,
				description: `Booked through Litesubs. Booking ${created.bookingId}.`,
				start: new Date(created.startsAt),
				end: new Date(created.endsAt),
				timeZone: schedule.timezone,
			},
		);
		if (createdEvent.ok) {
			await db
				.update(bookings)
				.set({ externalEventId: createdEvent.data.eventId })
				.where(eq(bookings.id, created.bookingId))
				.catch(() => {
					// A failed bookkeeping write must not fail a real booking.
				});
		}

		await notifyBookingConfirmed({
			bookingId: created.bookingId,
			creatorId: schedule.creatorId,
			customerId: userId,
			startsAt: created.startsAt,
			endsAt: created.endsAt,
			scheduleName: schedule.name,
			timeZone: schedule.timezone,
			chargedCredits: created.chargedCredits,
			// A booking detail route does not exist yet; the bookings hub is the
			// honest destination for both parties.
			href: "/dashboard/bookings",
		});
		return created;
	} catch (error) {
		// The exclusion constraint is the real guard; translate it into the same
		// answer a lost race deserves rather than a 500.
		if (isOverlapViolation(error))
			throw new ServiceError(
				"SLOT_UNAVAILABLE",
				"That time was just taken. Pick another slot.",
				409,
			);
		throw error;
	}
}

function isOverlapViolation(error: unknown) {
	// Drizzle wraps driver failures in `DrizzleQueryError`, whose message is the
	// SQL text and whose `code` is undefined. The Postgres error actually carries
	// `23P01`/the constraint name, and it lives on `cause`. Inspecting only the
	// top-level object meant this never matched, so a lost race surfaced as a 500
	// instead of "That time was just taken." Walk the chain rather than guessing
	// one shape: a driver upgrade or an extra wrapper must not resurrect the 500.
	for (let current: unknown = error; current; ) {
		if (typeof current !== "object") return false;
		const code = (current as { code?: string }).code;
		const constraint = (current as { constraint?: string }).constraint;
		if (code === "23P01") return true; // exclusion_violation
		if (code === "23505" && constraint === "booking_no_overlap_per_creator")
			return true;
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

/**
 * Cancel a booking and give back exactly what it spent.
 *
 * Whoever owns the booking may cancel it: its customer, or the creator whose
 * schedule it belongs to. The restore targets the grants the debit allocated
 * from, so a cancelled booking cannot conjure credits that were already spent
 * elsewhere or that have expired.
 */
export async function cancelBooking(
	principal: Principal,
	input: { bookingId: string; reason?: string },
) {
	const booking = await db.query.bookings.findFirst({
		where: eq(bookings.id, input.bookingId),
		columns: {
			id: true,
			scheduleId: true,
			creatorId: true,
			userId: true,
			planId: true,
			status: true,
			chargedCredits: true,
			chargeTransactionId: true,
			externalEventId: true,
			startsAt: true,
		},
	});
	if (!booking) throw new ServiceError("NOT_FOUND", "Booking not found", 404);
	if (
		principal.creatorId !== booking.creatorId &&
		principal.userId !== booking.userId
	)
		throw new ServiceError("NOT_FOUND", "Booking not found", 404);
	if (booking.status === "cancelled")
		return { status: "already_cancelled" as const, restored: 0 };

	const result = await db.transaction(async (tx) => {
		// Lock the row so two concurrent cancels cannot both restore.
		const [locked] = await tx
			.select()
			.from(bookings)
			.where(eq(bookings.id, booking.id))
			.for("update");
		if (locked.status === "cancelled")
			return { status: "already_cancelled" as const, restored: 0 };
		if (locked.startsAt.getTime() <= Date.now())
			throw new ServiceError(
				"BOOKING_STARTED",
				"This booking has already started and cannot be cancelled here",
				409,
			);

		const restored = await restoreBookingCredits(tx, locked);
		await tx
			.update(bookings)
			.set({
				status: "cancelled",
				cancelledAt: new Date(),
				cancellationReason: input.reason ?? null,
				refundTransactionId: restored.transactionId,
			})
			.where(eq(bookings.id, booking.id));

		const enrollment = locked.planId
			? await tx.query.enrollments.findFirst({
					where: and(
						eq(enrollments.userId, locked.userId),
						eq(enrollments.planId, locked.planId),
					),
					columns: { id: true },
				})
			: undefined;
		const balance = enrollment ? await usableBalance(tx, enrollment.id) : 0;
		return {
			status: "cancelled" as const,
			restored: restored.credits,
			balance,
		};
	});

	// Remove the mirrored calendar event, best-effort and after commit. The
	// cancellation and the credit restore already stand; a Google failure only
	// leaves an event behind for the creator to delete by hand.
	if (result.status === "cancelled" && booking.externalEventId) {
		await bestEffortDeleteBookingEvent(
			booking.creatorId,
			booking.externalEventId,
		);
	}

	// Announced only after the cancellation and the restore committed, so the
	// credit outcome in the copy is the one that actually happened.
	if (result.status === "cancelled") {
		const actor: "creator" | "customer" =
			principal.creatorId === booking.creatorId &&
			principal.userId !== booking.userId
				? "creator"
				: "customer";
		const schedule = await db.query.bookingSchedules.findFirst({
			where: eq(bookingSchedules.id, booking.scheduleId),
			columns: { name: true, timezone: true },
		});
		await notifyBookingCancelled({
			bookingId: booking.id,
			creatorId: booking.creatorId,
			customerId: booking.userId,
			startsAt: booking.startsAt,
			scheduleName: schedule?.name,
			timeZone: schedule?.timezone,
			chargedCredits: booking.chargedCredits,
			restoredCredits: result.restored,
			cancelledBy: actor,
			href: "/dashboard/bookings",
		});
	}
	return result;
}

/**
 * Return a booking's own units to the grants they came from.
 *
 * `remaining` may never exceed `amount`, and an expired grant is not revived:
 * both rules exist so a book/cancel loop cannot manufacture a balance.
 */
async function restoreBookingCredits(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	booking: typeof bookings.$inferSelect,
) {
	if (booking.chargedCredits === 0 || !booking.chargeTransactionId)
		return { credits: 0, transactionId: null };

	const allocations = await tx
		.select({
			grantId: creditAllocations.grantId,
			amount: creditAllocations.amount,
		})
		.from(creditAllocations)
		.where(eq(creditAllocations.transactionId, booking.chargeTransactionId));

	const perGrant: { grantId: string; amount: number }[] = [];
	let total = 0;
	for (const allocation of allocations) {
		const grant = await tx.query.creditGrants.findFirst({
			where: eq(creditGrants.id, allocation.grantId),
			columns: { id: true, remaining: true, amount: true, expiresAt: true },
		});
		if (!grant) continue;
		if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) continue;
		const room = grant.amount - grant.remaining;
		const restore = Math.min(allocation.amount, room);
		if (restore <= 0) continue;
		perGrant.push({ grantId: grant.id, amount: restore });
		total += restore;
	}

	if (total === 0) return { credits: 0, transactionId: null };

	const enrollment = await tx.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, booking.userId),
			eq(enrollments.planId, booking.planId as string),
		),
		columns: { id: true },
	});
	const balanceBefore = enrollment ? await usableBalance(tx, enrollment.id) : 0;

	const [entry] = await tx
		.insert(transactions)
		.values({
			userId: booking.userId,
			creatorId: booking.creatorId,
			planId: booking.planId,
			amount: total,
			type: "refund",
			status: "completed",
			description: `Booking cancelled; ${total} credit(s) returned`,
			idempotencyKey: `booking-cancel:${booking.id}`,
			balanceBefore,
			balanceAfter: balanceBefore + total,
		})
		.returning({ id: transactions.id });

	for (const item of perGrant) {
		await tx
			.update(creditGrants)
			.set({ remaining: sql`${creditGrants.remaining} + ${item.amount}` })
			.where(eq(creditGrants.id, item.grantId));
	}
	if (enrollment) {
		const balance = await usableBalance(tx, enrollment.id);
		await tx
			.update(enrollments)
			.set({ credits: balance })
			.where(eq(enrollments.id, enrollment.id));
	}
	return { credits: total, transactionId: entry.id };
}
