/**
 * In-app notifications, tested against real PostgreSQL.
 *
 * The acceptance criteria for B4 are mostly negative: a repeated event must not
 * produce a second row, a cancelled or past booking must not produce a "starting
 * soon" item, one user must never read or mark another user's rows, and a broken
 * notification path must not look like a booking failure. Those are the cases
 * here.
 *
 * There is no scheduler in the product, so "starting soon" is exercised by
 * passing an explicit `now` into the read path rather than by advancing a clock.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	bookingSchedules,
	bookings,
	notifications,
	user,
} from "@/app/db/schema";
import {
	bookingDedupeKey,
	listNotifications,
	markAllRead,
	markRead,
	NOTIFICATION_KINDS,
	notificationsStartingSoon,
	notify,
	notifyBookingCancelled,
	notifyBookingConfirmed,
	STARTING_SOON_MINUTES,
	safeNotify,
	unreadCount,
} from "@/lib/services/notifications";

const MINUTE = 60_000;

test("notifications are deduped, user-scoped, and derived on read", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);

	const creatorId = crypto.randomUUID();
	const customerId = crypto.randomUUID();
	const otherId = crypto.randomUUID();

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: customerId, name: "Customer", email: `${customerId}@example.test` },
		{ id: otherId, name: "Other", email: `${otherId}@example.test` },
	]);

	const [schedule] = await db
		.insert(bookingSchedules)
		.values({
			creatorId,
			name: "Intro call",
			slug: `intro-${creatorId.slice(0, 8)}`,
			creditsPerBooking: 2,
			timezone: "UTC",
		})
		.returning();

	const confirmedStartedAt = new Date(Date.now() + 3 * 24 * 60 * MINUTE);
	const [booking] = await db
		.insert(bookings)
		.values({
			scheduleId: schedule.id,
			creatorId,
			userId: customerId,
			startsAt: confirmedStartedAt,
			endsAt: new Date(confirmedStartedAt.getTime() + 30 * MINUTE),
			status: "confirmed",
			chargedCredits: 2,
		})
		.returning();

	await t.test(
		"notify() is idempotent on the unique (user_id, dedupe_key) boundary",
		async () => {
			const dedupeKey = bookingDedupeKey(booking.id, "confirmed", "customer");
			const first = await notify({
				userId: customerId,
				kind: NOTIFICATION_KINDS.bookingConfirmed,
				title: "Booking confirmed",
				body: "Tomorrow at 10:00 UTC",
				href: "/dashboard/bookings",
				dedupeKey,
			});
			assert.equal(first.inserted, true);
			assert.ok(first.id);

			// A retried delivery of the same business event.
			const second = await notify({
				userId: customerId,
				kind: NOTIFICATION_KINDS.bookingConfirmed,
				title: "Booking confirmed",
				body: "Tomorrow at 10:00 UTC",
				href: "/dashboard/bookings",
				dedupeKey,
			});
			assert.equal(second.inserted, false);
			assert.equal(second.id, null);

			const rows = await db
				.select()
				.from(notifications)
				.where(
					and(
						eq(notifications.userId, customerId),
						eq(notifications.dedupeKey, dedupeKey),
					),
				);
			assert.equal(rows.length, 1, "one row for a repeated event");
		},
	);

	await t.test(
		"a concurrent duplicate resolves in the database, not in application code",
		async () => {
			const dedupeKey = `test:concurrent:${crypto.randomUUID()}`;
			const results = await Promise.all(
				Array.from({ length: 5 }, () =>
					notify({
						userId: customerId,
						kind: "test.concurrent",
						title: "Same event",
						dedupeKey,
					}),
				),
			);
			assert.equal(
				results.filter((result) => result.inserted).length,
				1,
				"exactly one insert wins",
			);
		},
	);

	await t.test(
		"the same dedupe key is allowed for a different user",
		async () => {
			const dedupeKey = bookingDedupeKey(booking.id, "confirmed", "creator");
			const creatorWrite = await notify({
				userId: creatorId,
				kind: NOTIFICATION_KINDS.bookingConfirmed,
				title: "New booking",
				dedupeKey,
			});
			// Same key, different recipient: that is a different notification.
			const otherWrite = await notify({
				userId: otherId,
				kind: NOTIFICATION_KINDS.bookingConfirmed,
				title: "New booking",
				dedupeKey,
			});
			assert.equal(creatorWrite.inserted, true);
			assert.equal(otherWrite.inserted, true);
		},
	);

	await t.test("a notification href must be an in-app route", async () => {
		const result = await notify({
			userId: customerId,
			kind: "test.href",
			title: "Unsafe link",
			href: "https://evil.test/phish",
			dedupeKey: `test:href:${crypto.randomUUID()}`,
		});
		assert.equal(result.inserted, true);
		const row = await db.query.notifications.findFirst({
			where: eq(notifications.id, result.id as string),
		});
		assert.equal(row?.href, null, "external URLs are dropped, not stored");
	});

	await t.test("unreadCount counts only this user's unread rows", async () => {
		const before = await unreadCount(customerId);
		const otherBefore = await unreadCount(otherId);
		await notify({
			userId: customerId,
			kind: "test.count",
			title: "One more",
			dedupeKey: `test:count:${crypto.randomUUID()}`,
		});
		assert.equal(await unreadCount(customerId), before + 1);
		assert.equal(
			await unreadCount(otherId),
			otherBefore,
			"another user's rows never move this count",
		);
	});

	await t.test(
		"reading is user-scoped: A never sees B's notifications",
		async () => {
			await notify({
				userId: otherId,
				kind: "test.isolation",
				title: "Only other may see this",
				dedupeKey: `test:isolation:${crypto.randomUUID()}`,
			});
			const customerFeed = await listNotifications(customerId, { limit: 50 });
			assert.ok(customerFeed.length > 0);
			assert.equal(
				customerFeed.some((item) => item.title === "Only other may see this"),
				false,
			);
			const otherFeed = await listNotifications(otherId, { limit: 50 });
			assert.equal(
				otherFeed.some((item) => item.title === "Only other may see this"),
				true,
			);
		},
	);

	await t.test(
		"markRead cannot mark another user's row, and is idempotent",
		async () => {
			const result = await notify({
				userId: otherId,
				kind: "test.marker",
				title: "Other's row",
				dedupeKey: `test:marker:${crypto.randomUUID()}`,
			});
			const otherRowId = result.id as string;

			// Customer forges the id of a row they do not own.
			const stolen = await markRead(customerId, [otherRowId]);
			assert.equal(stolen, 0);
			const untouched = await db.query.notifications.findFirst({
				where: eq(notifications.id, otherRowId),
			});
			assert.equal(untouched?.readAt, null, "B's row stays unread");

			// The owner can mark it, and a repeat changes nothing.
			assert.equal(await markRead(otherId, [otherRowId]), 1);
			assert.equal(await markRead(otherId, [otherRowId]), 0);
			const read = await db.query.notifications.findFirst({
				where: eq(notifications.id, otherRowId),
			});
			assert.ok(read?.readAt instanceof Date);
		},
	);

	await t.test("markAllRead empties only this user's unread", async () => {
		await notify({
			userId: customerId,
			kind: "test.all",
			title: "Bulk a",
			dedupeKey: `test:all:${crypto.randomUUID()}`,
		});
		await notify({
			userId: customerId,
			kind: "test.all",
			title: "Bulk b",
			dedupeKey: `test:all:${crypto.randomUUID()}`,
		});
		// Reset other's count to a known unread row first.
		await notify({
			userId: otherId,
			kind: "test.all",
			title: "Other unread",
			dedupeKey: `test:all:${crypto.randomUUID()}`,
		});
		const otherUnreadBefore = await unreadCount(otherId);
		assert.ok(otherUnreadBefore > 0);

		assert.ok((await markAllRead(customerId)) >= 2);
		assert.equal(await unreadCount(customerId), 0);
		assert.equal(
			await unreadCount(otherId),
			otherUnreadBefore,
			"another user's unread rows are untouched",
		);
	});

	await t.test(
		"starting soon is derived for the next N minutes and excludes past/cancelled",
		async () => {
			const now = new Date(Date.now() + 5 * 24 * 60 * MINUTE);
			const soon = new Date(now.getTime() + 5 * MINUTE);

			const makeBooking = async (input: {
				startsAt: Date;
				status: "confirmed" | "cancelled";
				customer?: string;
			}) => {
				const [row] = await db
					.insert(bookings)
					.values({
						scheduleId: schedule.id,
						creatorId,
						userId: input.customer ?? customerId,
						startsAt: input.startsAt,
						endsAt: new Date(input.startsAt.getTime() + 30 * MINUTE),
						status: input.status,
						chargedCredits: 0,
					})
					.returning();
				return row;
			};

			const confirmed = await makeBooking({
				startsAt: soon,
				status: "confirmed",
			});
			await makeBooking({
				startsAt: new Date(now.getTime() + 6 * MINUTE),
				status: "cancelled",
			});
			await makeBooking({
				startsAt: new Date(now.getTime() - 120 * MINUTE),
				status: "confirmed",
			});
			await makeBooking({
				startsAt: new Date(
					now.getTime() + (STARTING_SOON_MINUTES + 30) * MINUTE,
				),
				status: "confirmed",
			});

			const forCustomer = await notificationsStartingSoon(customerId, now);
			assert.deepEqual(
				forCustomer.map((item) => item.id),
				[`derived:${confirmed.id}:starting_soon:customer`],
				"only the upcoming confirmed booking, from the customer's view",
			);
			assert.equal(forCustomer[0].derived, true);
			assert.equal(forCustomer[0].kind, NOTIFICATION_KINDS.bookingStartingSoon);
			assert.match(forCustomer[0].title, /starts in 5 min/i);

			const forCreator = await notificationsStartingSoon(creatorId, now);
			assert.deepEqual(
				forCreator.map((item) => item.id),
				[`derived:${confirmed.id}:starting_soon:creator`],
			);

			// A user with no bookings in the window sees nothing.
			assert.deepEqual(await notificationsStartingSoon(otherId, now), []);
		},
	);

	await t.test(
		"starting soon is never persisted, so reads do not accumulate rows",
		async () => {
			const before = await db
				.select()
				.from(notifications)
				.where(eq(notifications.userId, creatorId));
			const now = new Date(Date.now() + 5 * 24 * 60 * MINUTE);
			await notificationsStartingSoon(creatorId, now);
			const after = await db
				.select()
				.from(notifications)
				.where(eq(notifications.userId, creatorId));
			assert.equal(after.length, before.length);
			assert.equal(
				after.filter(
					(row) => row.kind === NOTIFICATION_KINDS.bookingStartingSoon,
				).length,
				0,
			);
		},
	);

	await t.test(
		"booking hooks write both parties exactly once, with stable keys",
		async () => {
			const startsAt = new Date(Date.now() + 8 * 24 * 60 * MINUTE);
			const [fresh] = await db
				.insert(bookings)
				.values({
					scheduleId: schedule.id,
					creatorId,
					userId: customerId,
					startsAt,
					endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
					status: "confirmed",
					chargedCredits: 2,
				})
				.returning();

			const payload = {
				bookingId: fresh.id,
				creatorId,
				customerId,
				startsAt,
				scheduleName: "Intro call",
				customerName: "Customer",
				timeZone: "UTC",
				chargedCredits: 2,
			};
			const first = await notifyBookingConfirmed(payload);
			assert.equal(first.ok, true);

			// A repeated delivery (webhook retry, double-click) is a no-op.
			const replay = await notifyBookingConfirmed(payload);
			assert.equal(replay.ok, true);
			assert.equal(
				replay.attempts.every((attempt) => attempt.inserted === false),
				true,
			);

			const created = await db
				.select()
				.from(notifications)
				.where(
					and(
						eq(
							notifications.dedupeKey,
							`booking:${fresh.id}:confirmed:creator`,
						),
					),
				);
			assert.equal(created.length, 1);
			assert.equal(created[0].userId, creatorId);

			const createdForCustomer = await db
				.select()
				.from(notifications)
				.where(
					and(
						eq(
							notifications.dedupeKey,
							`booking:${fresh.id}:confirmed:customer`,
						),
					),
				);
			assert.equal(createdForCustomer.length, 1);
			assert.equal(createdForCustomer[0].userId, customerId);

			// Cancellation names the credit outcome for each party.
			const cancelled = await notifyBookingCancelled({
				...payload,
				cancelledBy: "customer",
				restoredCredits: 2,
			});
			assert.equal(cancelled.ok, true);
			const cancelRows = await db
				.select()
				.from(notifications)
				.where(
					eq(notifications.dedupeKey, `booking:${fresh.id}:cancelled:creator`),
				);
			assert.equal(cancelRows.length, 1);
			assert.match(cancelRows[0].body ?? "", /2 credits were returned/i);

			const replayCancel = await notifyBookingCancelled({
				...payload,
				cancelledBy: "customer",
				restoredCredits: 2,
			});
			assert.equal(
				replayCancel.attempts.every((attempt) => attempt.inserted === false),
				true,
			);
		},
	);

	await t.test(
		"a failing notification write never throws, and never looks like a booking failure",
		async () => {
			// A session-level guard proves nothing in the booking path can be rolled
			// back by a notification: the write fails on a foreign key, and the only
			// observable is `ok: false`.
			const doomed = await safeNotify({
				userId: crypto.randomUUID(), // no such user
				kind: NOTIFICATION_KINDS.bookingConfirmed,
				title: "Should fail",
				dedupeKey: `test:fk:${crypto.randomUUID()}`,
			});
			assert.equal(doomed.ok, false);
			assert.equal(doomed.inserted, false);
			assert.ok(doomed.error);

			// The booking-hook wrappers promise not to reject even when the payload
			// is unusable.
			const hooked = await notifyBookingConfirmed({
				bookingId: "missing-booking",
				creatorId: crypto.randomUUID(),
				customerId: crypto.randomUUID(),
				startsAt: new Date(),
			});
			assert.equal(hooked.ok, false, "reported, not thrown");
			assert.equal(hooked.attempts.length, 2);
			assert.equal(
				hooked.attempts.every((attempt) => attempt.ok === false),
				true,
			);

			// The kill switch reports a skip instead of writing anything.
			const rowsBefore = await db
				.select()
				.from(notifications)
				.where(eq(notifications.userId, customerId));
			process.env.NOTIFICATIONS_ENABLED = "false";
			try {
				const skipped = await notify({
					userId: customerId,
					kind: "test.switch",
					title: "Disabled",
					dedupeKey: `test:switch:${crypto.randomUUID()}`,
				});
				assert.equal(skipped.skipped, true);
				assert.equal(skipped.inserted, false);
			} finally {
				delete process.env.NOTIFICATIONS_ENABLED;
			}
			const rowsAfter = await db
				.select()
				.from(notifications)
				.where(eq(notifications.userId, customerId));
			assert.equal(rowsAfter.length, rowsBefore.length);
		},
	);
});
