import { and, eq, sql } from "drizzle-orm";
import { db } from "@/app/db";
import {
	calBookings,
	calcomIntegrations,
	creditAllocations,
	creditGrants,
	enrollments,
	integrations,
	plans,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import { usableBalance } from "./credit-balance";
import { allocateDebit } from "./credits";

/**
 * Credits spent by Cal.com bookings.
 *
 * Cal.com owns scheduling; Litesubs owns the credits. The bridge is the signed
 * webhook plus the booking uid, and the rules this service enforces are:
 *
 * - A booking spends credits only when the event type has a configured price,
 *   the booker is a Litesubs user enrolled on that plan, and the plan is still
 *   linked to that event type. Anything else is recorded as "nothing happened"
 *   rather than guessed at.
 * - The booking uid is the idempotency boundary. Cal.com retries deliveries, so
 *   the second delivery of the same booking must not spend again.
 * - A cancellation restores exactly what that booking's debit took, back to the
 *   same grants it came from. It never creates new credits, so a customer cannot
 *   manufacture a balance by booking and cancelling repeatedly, and it never
 *   restores more than was charged even if the plan price changed since.
 * - Spending is all-or-nothing: a booker without enough credits is refused
 *   loudly so the creator can see the booking did not consume anything.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CalBookingIdentity = {
	bookingUid: string;
	eventTypeId: number | null;
	/** The booker's email; Cal.com's attendee identity. */
	email: string;
	startsAt: Date | null;
};

export type ChargeBookingResult =
	| { status: "charged"; bookingId: string; credits: number; balance: number }
	| { status: "replayed"; bookingId: string; credits: number; balance: number }
	| { status: "free" }
	| { status: "unknown_event_type" }
	| { status: "unknown_customer" }
	| { status: "not_enrolled" };

export type RestoreBookingResult =
	| { status: "restored"; bookingId: string; credits: number; balance: number }
	| { status: "already_restored"; bookingId: string; credits: number }
	| { status: "unknown_booking" }
	| { status: "nothing_charged" }
	| { status: "credits_spent"; bookingId: string; credits: number };

/**
 * Spend credits for one confirmed booking.
 *
 * Runs entirely in one transaction: the booking row is claimed first so a
 * concurrent duplicate cannot also debit, and the debit rolls back with it if
 * the balance is short. A `null` event type id is a signed but unattributable
 * event, which is refused rather than matched to a plan by luck.
 */
export async function chargeCalBooking(
	input: CalBookingIdentity,
): Promise<ChargeBookingResult> {
	return db.transaction(async (tx) => {
		const replay = await tx.query.calBookings.findFirst({
			where: eq(calBookings.bookingUid, input.bookingUid),
			columns: {
				id: true,
				chargedCredits: true,
				enrollmentId: true,
			},
		});
		if (replay)
			return {
				status: "replayed" as const,
				bookingId: replay.id,
				credits: replay.chargedCredits,
				balance: await usableBalance(tx, replay.enrollmentId),
			};

		const target = await resolveBookingTarget(tx, input);
		if (target.status !== "resolved") return target;

		// A free event type keeps the booking link but writes no ledger row; the
		// booking is still recorded so a later cancellation is unambiguous.
		if (!target.creditsPerBooking) {
			await tx.insert(calBookings).values({
				bookingUid: input.bookingUid,
				creatorId: target.creatorId,
				userId: target.userId,
				planId: target.planId,
				enrollmentId: target.enrollmentId,
				calcomIntegrationId: target.calcomIntegrationId,
				chargedCredits: 0,
				startsAt: input.startsAt,
			});
			return { status: "free" as const };
		}

		const [booking] = await tx
			.insert(calBookings)
			.values({
				bookingUid: input.bookingUid,
				creatorId: target.creatorId,
				userId: target.userId,
				planId: target.planId,
				enrollmentId: target.enrollmentId,
				calcomIntegrationId: target.calcomIntegrationId,
				chargedCredits: target.creditsPerBooking,
				startsAt: input.startsAt,
			})
			.returning({ id: calBookings.id });

		const before = await usableBalance(tx, target.enrollmentId);
		const [entry] = await tx
			.insert(transactions)
			.values({
				userId: target.userId,
				creatorId: target.creatorId,
				planId: target.planId,
				planVersionId: target.planVersionId,
				amount: -target.creditsPerBooking,
				type: "usage",
				status: "completed",
				description: `Cal.com booking ${input.bookingUid}`,
				// Scoped to the creator by the transaction index; the booking uid is
				// already globally unique, so this cannot collide with an API key.
				idempotencyKey: `cal:${input.bookingUid}`,
				balanceBefore: before,
				balanceAfter: before - target.creditsPerBooking,
			})
			.returning({ id: transactions.id });

		// Allocate inside this transaction so an insufficient balance rolls back
		// the booking claim too, and no partial spend is ever visible.
		await allocateDebit(tx, {
			enrollmentId: target.enrollmentId,
			creatorId: target.creatorId,
			amount: target.creditsPerBooking,
			transactionId: entry.id,
		});
		const balance = await usableBalance(tx, target.enrollmentId);
		await tx
			.update(enrollments)
			.set({ credits: balance })
			.where(eq(enrollments.id, target.enrollmentId));
		await tx
			.update(calBookings)
			.set({ chargeTransactionId: entry.id })
			.where(eq(calBookings.id, booking.id));

		return {
			status: "charged" as const,
			bookingId: booking.id,
			credits: target.creditsPerBooking,
			balance,
		};
	});
}

type ResolvedTarget =
	| {
			status: "resolved";
			creatorId: string;
			userId: string;
			planId: string;
			enrollmentId: string;
			planVersionId: string | null;
			calcomIntegrationId: string;
			creditsPerBooking: number | null;
	  }
	| { status: "unknown_event_type" }
	| { status: "unknown_customer" }
	| { status: "not_enrolled" };

/**
 * Map an event type back to the one plan that sells it, then to the booker's
 * enrollment on that plan.
 *
 * Every lookup is explicit: a missing link is reported, never defaulted. The
 * booker is resolved by email because that is the only identity Cal.com sends
 * that we can match to an account.
 */
async function resolveBookingTarget(
	tx: Tx,
	input: CalBookingIdentity,
): Promise<ResolvedTarget> {
	if (input.eventTypeId === null) return { status: "unknown_event_type" };

	// The same event type could have been attached to a plan, detached, and
	// attached elsewhere. Only a current plan link may spend credits.
	const link = await tx
		.select({
			planId: plans.id,
			creatorId: plans.creatorId,
			calcomIntegrationId: calcomIntegrations.id,
			creditsPerBooking: calcomIntegrations.creditsPerBooking,
		})
		.from(integrations)
		.innerJoin(
			calcomIntegrations,
			eq(integrations.calcomIntegrationId, calcomIntegrations.id),
		)
		.innerJoin(plans, eq(plans.integrationId, integrations.id))
		.where(
			and(
				eq(integrations.type, "calcom"),
				eq(calcomIntegrations.eventTypeId, input.eventTypeId),
			),
		)
		.limit(1);
	const match = link[0];
	if (!match) return { status: "unknown_event_type" };

	const booker = await tx.query.user.findFirst({
		where: sql`lower(${user.email}) = ${input.email.trim().toLowerCase()}`,
		columns: { id: true },
	});
	if (!booker) return { status: "unknown_customer" };

	const enrollment = await tx.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, booker.id),
			eq(enrollments.planId, match.planId),
		),
		columns: { id: true },
	});
	if (!enrollment) return { status: "not_enrolled" };

	const version = await tx.query.planVersions.findFirst({
		where: and(
			eq(planVersions.planId, match.planId),
			eq(planVersions.status, "published"),
		),
		columns: { id: true },
	});

	return {
		status: "resolved",
		creatorId: match.creatorId,
		userId: booker.id,
		planId: match.planId,
		enrollmentId: enrollment.id,
		planVersionId: version?.id ?? null,
		calcomIntegrationId: match.calcomIntegrationId,
		creditsPerBooking: match.creditsPerBooking,
	};
}

/**
 * Give back exactly what a cancelled booking spent.
 *
 * The units go back to the grants the debit allocated from, up to what is still
 * spendable there. That keeps expiry truthful (a cancelled booking cannot
 * resurrect an expired period) and makes repeat cancellations idempotent. If the
 * units were already spent elsewhere, nothing is invented: the result says so
 * instead of granting a fresh balance.
 */
export async function restoreCalBooking(input: {
	bookingUid: string;
}): Promise<RestoreBookingResult> {
	return db.transaction(async (tx) => {
		const [booking] = await tx
			.select()
			.from(calBookings)
			.where(eq(calBookings.bookingUid, input.bookingUid))
			.for("update");
		if (!booking) return { status: "unknown_booking" as const };
		if (booking.chargedCredits === 0)
			return { status: "nothing_charged" as const };
		if (booking.cancelledAt)
			return {
				status: "already_restored" as const,
				bookingId: booking.id,
				credits: booking.chargedCredits,
			};

		const allocations = booking.chargeTransactionId
			? await tx
					.select({
						grantId: creditAllocations.grantId,
						amount: creditAllocations.amount,
					})
					.from(creditAllocations)
					.where(
						eq(creditAllocations.transactionId, booking.chargeTransactionId),
					)
			: [];

		let restoreable = 0;
		const perGrant: { grantId: string; amount: number }[] = [];
		for (const allocation of allocations) {
			const grant = await tx.query.creditGrants.findFirst({
				where: eq(creditGrants.id, allocation.grantId),
				columns: { id: true, remaining: true, amount: true, expiresAt: true },
			});
			if (!grant) continue;
			// An expired grant must not come back to life: the unit is not usable
			// any more, and resurrecting it would hand out credits past their term.
			if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) continue;
			// Only the portion still absent from the grant can return; units
			// already re-spent elsewhere are gone.
			const room = grant.amount - grant.remaining;
			const restore = Math.min(allocation.amount, room);
			if (restore <= 0) continue;
			perGrant.push({ grantId: grant.id, amount: restore });
			restoreable += restore;
		}

		const balanceBefore = await usableBalance(tx, booking.enrollmentId);
		if (restoreable === 0) {
			// The booking is still marked cancelled so it is not retried forever,
			// but the ledger says plainly that nothing came back.
			await tx
				.update(calBookings)
				.set({ cancelledAt: new Date() })
				.where(eq(calBookings.id, booking.id));
			return {
				status: "credits_spent" as const,
				bookingId: booking.id,
				credits: 0,
			};
		}

		const [entry] = await tx
			.insert(transactions)
			.values({
				userId: booking.userId,
				creatorId: booking.creatorId,
				planId: booking.planId,
				amount: restoreable,
				type: "refund",
				status: "completed",
				description: `Cal.com booking ${booking.bookingUid} cancelled; ${restoreable} credit(s) returned`,
				idempotencyKey: `cal-cancel:${booking.bookingUid}`,
				balanceBefore,
				balanceAfter: balanceBefore + restoreable,
			})
			.returning({ id: transactions.id });

		// `credit_allocations.amount` is a positive debit attribution by
		// constraint, so a return is recorded on the grant itself rather than as a
		// negative allocation. The refund ledger row above is the audit trail.
		for (const item of perGrant) {
			await tx
				.update(creditGrants)
				.set({ remaining: sql`${creditGrants.remaining} + ${item.amount}` })
				.where(eq(creditGrants.id, item.grantId));
		}
		const balance = await usableBalance(tx, booking.enrollmentId);
		await tx
			.update(enrollments)
			.set({ credits: balance })
			.where(eq(enrollments.id, booking.enrollmentId));
		await tx
			.update(calBookings)
			.set({ cancelledAt: new Date(), refundTransactionId: entry.id })
			.where(eq(calBookings.id, booking.id));

		return {
			status: "restored" as const,
			bookingId: booking.id,
			credits: restoreable,
			balance,
		};
	});
}
