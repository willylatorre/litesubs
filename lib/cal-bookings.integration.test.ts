/**
 * A Cal.com booking is an external event that spends real customer credits, so
 * these cases target what would cost someone money or trust: double-charging a
 * retried delivery, charging the wrong plan, inventing credits on cancellation,
 * and silently granting credits when the balance is short.
 *
 * Real service and database throughout; Cal.com's HTTP API is not called,
 * because the webhook is already authenticated before this service runs.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	calBookings,
	calcomIntegrations,
	creditGrants,
	enrollments,
	integrations,
	plans,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import {
	chargeCalBooking,
	restoreCalBooking,
} from "@/lib/services/cal-bookings";
import { changeCredits, usableBalance } from "@/lib/services/credits";
import { sessionPrincipal } from "@/lib/services/principal";

test("Cal.com bookings spend credits once and a cancellation returns only what was charged", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherCreatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const strangerId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{
			id: otherCreatorId,
			name: "Other creator",
			email: `${otherCreatorId}@example.test`,
		},
		{ id: buyerId, name: "Buyer", email: `Booker-${buyerId}@Example.test` },
		{ id: strangerId, name: "Stranger", email: `${strangerId}@example.test` },
	]);

	const [plan] = await db
		.insert(plans)
		.values({ creatorId, name: "Coaching sessions" })
		.returning();
	const [version] = await db
		.insert(planVersions)
		.values({
			planId: plan.id,
			creatorId,
			status: "published",
			billingMode: "one_time",
			currency: "usd",
			price: 10_000,
			credits: 10,
			version: 1,
			publishedAt: new Date(),
		})
		.returning();
	const [calcom] = await db
		.insert(calcomIntegrations)
		.values({
			eventTypeId: 4242,
			eventTypeSlug: "coaching",
			eventTypeName: "Coaching call",
			eventTypeUrl: "https://cal.com/creator/coaching",
			creditsPerBooking: 3,
			connectedAt: new Date(),
		})
		.returning();
	const [integration] = await db
		.insert(integrations)
		.values({
			userId: creatorId,
			type: "calcom",
			calcomIntegrationId: calcom.id,
		})
		.returning();
	await db
		.update(plans)
		.set({ integrationId: integration.id })
		.where(eq(plans.id, plan.id));

	const [enrollment] = await db
		.insert(enrollments)
		.values({ userId: buyerId, planId: plan.id, creatorId })
		.returning();

	// Ten credits bought as a pack. A real purchase is not needed to test a
	// debit, and changeCredits is the same funnel every grant goes through.
	await changeCredits(
		creator,
		{ customer: buyerId, plan: plan.id, amount: 10, reason: "Pack purchase" },
		"manual_adjustment",
	);
	assert.equal(await usableBalance(db, enrollment.id), 10);

	const booking = {
		bookingUid: `bk_${crypto.randomUUID()}`,
		eventTypeId: 4242,
		email: `booker-${buyerId}@example.test`,
		startsAt: new Date(Date.now() + 86_400_000),
	};

	await t.test(
		"a confirmed booking spends exactly the configured price",
		async () => {
			const charged = await chargeCalBooking(booking);
			assert.equal(charged.status, "charged");
			if (charged.status !== "charged") return;
			assert.equal(charged.credits, 3);
			assert.equal(charged.balance, 7);
			assert.equal(await usableBalance(db, enrollment.id), 7);

			const row = await db.query.calBookings.findFirst({
				where: eq(calBookings.bookingUid, booking.bookingUid),
			});
			assert.equal(row?.chargedCredits, 3);
			assert.equal(row?.creatorId, creatorId);
			assert.ok(row?.chargeTransactionId);

			const ledger = await db.query.transactions.findFirst({
				where: eq(transactions.id, row?.chargeTransactionId as string),
			});
			assert.equal(ledger?.amount, -3);
			assert.equal(ledger?.type, "usage");
			assert.equal(ledger?.userId, buyerId);
			// The price actually charged is not rewritten by a later terms change.
			assert.equal(ledger?.planVersionId, version.id);
		},
	);

	await t.test(
		"a replay of the same delivery does not charge again",
		async () => {
			const replay = await chargeCalBooking(booking);
			assert.equal(replay.status, "replayed");
			if (replay.status !== "replayed") return;
			assert.equal(replay.credits, 3);
			assert.equal(replay.balance, 7);
			assert.equal(await usableBalance(db, enrollment.id), 7);
			assert.equal(
				(
					await db.query.calBookings.findMany({
						where: eq(calBookings.bookingUid, booking.bookingUid),
					})
				).length,
				1,
			);
		},
	);

	await t.test(
		"a reschedule is the same booking, so it is not a second charge",
		async () => {
			const rescheduled = await chargeCalBooking({
				...booking,
				startsAt: new Date(Date.now() + 2 * 86_400_000),
			});
			assert.equal(rescheduled.status, "replayed");
			assert.equal(await usableBalance(db, enrollment.id), 7);
		},
	);

	await t.test(
		"a cancellation returns the units to the same grants, once",
		async () => {
			const restored = await restoreCalBooking({
				bookingUid: booking.bookingUid,
			});
			assert.equal(restored.status, "restored");
			if (restored.status !== "restored") return;
			assert.equal(restored.credits, 3);
			assert.equal(restored.balance, 10);
			assert.equal(await usableBalance(db, enrollment.id), 10);

			// Cancelling the same booking again must not mint more credits.
			const again = await restoreCalBooking({
				bookingUid: booking.bookingUid,
			});
			assert.equal(again.status, "already_restored");
			assert.equal(await usableBalance(db, enrollment.id), 10);

			const grants = await db.query.creditGrants.findMany({
				where: eq(creditGrants.enrollmentId, enrollment.id),
			});
			assert.equal(
				grants.reduce((total, grant) => total + grant.remaining, 0),
				10,
				"a grant never exceeds the units it was created with",
			);
			assert.ok(
				grants.every((grant) => grant.remaining <= grant.amount),
				"no grant was inflated past its original size",
			);
		},
	);

	await t.test(
		"a cancellation returns its own units even when other credits were spent",
		async () => {
			const second = {
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
			};
			const charged = await chargeCalBooking(second);
			assert.equal(charged.status, "charged");
			// The booker then spends unrelated units, so the plan balance drops to
			// zero before the booking is cancelled.
			await changeCredits(
				creator,
				{
					customer: buyerId,
					plan: plan.id,
					amount: 7,
					reason: "Consumed outside Cal.com",
					idempotency_key: `spend_${crypto.randomUUID()}`,
				},
				"usage",
			);
			assert.equal(await usableBalance(db, enrollment.id), 0);

			const restored = await restoreCalBooking({
				bookingUid: second.bookingUid,
			});
			assert.equal(restored.status, "restored");
			if (restored.status !== "restored") return;
			// Exactly the booking's own 3 units come back; the unrelated spend stays
			// spent, and nothing is minted beyond what the booking took.
			assert.equal(restored.credits, 3);
			assert.equal(restored.balance, 3);
			const grants = await db.query.creditGrants.findMany({
				where: eq(creditGrants.enrollmentId, enrollment.id),
			});
			assert.ok(
				grants.every((grant) => grant.remaining <= grant.amount),
				"restoring never inflates a grant past its original size",
			);
		},
	);

	await t.test(
		"an expired grant is not resurrected by a cancellation",
		async () => {
			const expiring = {
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
			};
			const charged = await chargeCalBooking(expiring);
			assert.equal(charged.status, "charged");
			if (charged.status !== "charged") return;

			// The period ends before the cancellation arrives. Units past their
			// boundary are not spendable, so they must not be given back either.
			await db
				.update(creditGrants)
				.set({ expiresAt: new Date(Date.now() - 1000) })
				.where(eq(creditGrants.enrollmentId, enrollment.id));

			const restored = await restoreCalBooking({
				bookingUid: expiring.bookingUid,
			});
			assert.equal(restored.status, "credits_spent");
			if (restored.status !== "credits_spent") return;
			assert.equal(restored.credits, 0);
			assert.equal(await usableBalance(db, enrollment.id), 0);
			const row = await db.query.calBookings.findFirst({
				where: eq(calBookings.bookingUid, expiring.bookingUid),
			});
			assert.ok(row?.cancelledAt);
			assert.equal(row?.refundTransactionId, null);
		},
	);

	await t.test(
		"a booker with too few credits is refused, not partially charged",
		async () => {
			await changeCredits(
				creator,
				{ customer: buyerId, plan: plan.id, amount: 2, reason: "Top up" },
				"manual_adjustment",
			);
			const before = await usableBalance(db, enrollment.id);
			assert.equal(before, 2);
			await assert.rejects(
				chargeCalBooking({
					...booking,
					bookingUid: `bk_${crypto.randomUUID()}`,
				}),
				{ code: "INSUFFICIENT_CREDITS" },
			);
			assert.equal(
				await usableBalance(db, enrollment.id),
				2,
				"a refused booking spends nothing",
			);
			// The failed attempt left no booking row behind, so a retry can succeed.
			assert.equal(
				await db.query.calBookings.findFirst({
					where: eq(calBookings.chargedCredits, 0),
				}),
				undefined,
			);
		},
	);

	await t.test(
		"an unknown booker or unlinked event type spends nothing",
		async () => {
			// A signed-in user who is not enrolled on this plan.
			const notEnrolled = await chargeCalBooking({
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
				email: `${strangerId}@example.test`,
			});
			assert.equal(notEnrolled.status, "not_enrolled");

			// An email that matches no Litesubs account at all.
			const unknown = await chargeCalBooking({
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
				email: "nobody@example.test",
			});
			assert.equal(unknown.status, "unknown_customer");

			const unknownEvent = await chargeCalBooking({
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
				eventTypeId: 999_999,
			});
			assert.equal(unknownEvent.status, "unknown_event_type");

			// A signed event with no event type id is not matched to a plan by luck.
			const noEventType = await chargeCalBooking({
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
				eventTypeId: null,
			});
			assert.equal(noEventType.status, "unknown_event_type");

			const creatorBooking = await chargeCalBooking({
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
				email: `${creatorId}@example.test`,
			});
			assert.equal(creatorBooking.status, "not_enrolled");
		},
	);

	await t.test(
		"a free event type records the booking but spends nothing",
		async () => {
			await db
				.update(calcomIntegrations)
				.set({ creditsPerBooking: null })
				.where(eq(calcomIntegrations.id, calcom.id));
			const freeUid = `bk_${crypto.randomUUID()}`;
			const result = await chargeCalBooking({
				...booking,
				bookingUid: freeUid,
			});
			assert.equal(result.status, "free");
			const row = await db.query.calBookings.findFirst({
				where: eq(calBookings.bookingUid, freeUid),
			});
			assert.equal(row?.chargedCredits, 0);
			// A free booking has nothing to give back on cancellation.
			const restored = await restoreCalBooking({ bookingUid: freeUid });
			assert.equal(restored.status, "nothing_charged");
			await db
				.update(calcomIntegrations)
				.set({ creditsPerBooking: 3 })
				.where(eq(calcomIntegrations.id, calcom.id));
		},
	);

	await t.test(
		"a plan detached from the event type stops spending",
		async () => {
			const before = await usableBalance(db, enrollment.id);
			await db
				.update(plans)
				.set({ integrationId: null })
				.where(eq(plans.id, plan.id));
			const result = await chargeCalBooking({
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
			});
			assert.equal(result.status, "unknown_event_type");
			assert.equal(await usableBalance(db, enrollment.id), before);
		},
	);

	await t.test(
		"another creator's plan is not reachable by event type",
		async () => {
			const [otherPlan] = await db
				.insert(plans)
				.values({ creatorId: otherCreatorId, name: "Other sessions" })
				.returning();
			const [otherCalcom] = await db
				.insert(calcomIntegrations)
				.values({
					eventTypeId: 5151,
					creditsPerBooking: 1,
					connectedAt: new Date(),
				})
				.returning();
			const [otherIntegration] = await db
				.insert(integrations)
				.values({
					userId: otherCreatorId,
					type: "calcom",
					calcomIntegrationId: otherCalcom.id,
				})
				.returning();
			await db
				.update(plans)
				.set({ integrationId: otherIntegration.id })
				.where(eq(plans.id, otherPlan.id));

			const result = await chargeCalBooking({
				...booking,
				bookingUid: `bk_${crypto.randomUUID()}`,
				eventTypeId: 5151,
			});
			// The buyer is enrolled with the first creator only, so the other creator's
			// plan must not spend from that balance.
			assert.equal(result.status, "not_enrolled");
		},
	);

	for (const id of [creatorId, otherCreatorId, buyerId, strangerId])
		await db.delete(user).where(eq(user.id, id));
	await db.$client.end();
});
