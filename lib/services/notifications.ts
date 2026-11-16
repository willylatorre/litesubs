import {
	and,
	count,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	lt,
	lte,
	or,
} from "drizzle-orm";
import { db } from "@/app/db";
import { bookingSchedules, bookings, notifications } from "@/app/db/schema";
import { ServiceError } from "./principal";

/**
 * In-app notifications.
 *
 * There is no email and no scheduler in this product. Everything a user sees in
 * the bell is either a persisted row written by a booking event, or a
 * "starting soon" item computed from `bookings.starts_at` at read time. Nothing
 * here queues work, and nothing here needs a cron.
 *
 * Idempotency boundary: the database's unique `(user_id, dedupe_key)` constraint
 * on `notifications`. A repeated business event (a retried webhook, a re-run of a
 * cancellation) inserts nothing the second time. The dedupe key is the contract,
 * so it is built by the exported helpers below rather than by callers.
 *
 * ## Failure policy
 *
 * A notification is never part of a booking's correctness. Callers MUST treat a
 * notification failure as a non-event:
 *
 * - `notify()` is the raw primitive. It throws on a database error so an
 *   explicit caller can decide what to do.
 * - `notifyBookingConfirmed()` / `notifyBookingCancelled()` are the helpers the
 *   booking service calls. They never throw and never reject; a bad row, a
 *   missing user (FK violation), or a disabled notification path is logged and
 *   reported as `ok: false` while the booking and its credit debit stand.
 *
 * Intensity of that rule matters: a booking commit or a credit debit must never
 * be rolled back, retried, or reported as failed because a bell did not update.
 */
export const NOTIFICATION_KINDS = {
	bookingConfirmed: "booking.confirmed",
	bookingCancelled: "booking.cancelled",
	/** Derived on read; never persisted. */
	bookingStartingSoon: "booking.starting_soon",
} as const;

export type NotificationKind =
	(typeof NOTIFICATION_KINDS)[keyof typeof NOTIFICATION_KINDS];

/** How far ahead "starting soon" looks. Computed at read time, not scheduled. */
export const STARTING_SOON_MINUTES = 15;

export const DEFAULT_NOTIFICATION_LIMIT = 20;
export const MAX_NOTIFICATION_LIMIT = 50;

/**
 * The notification shape that crosses to the client. Instants are ISO strings so
 * the RSC/Server Action boundary stays simple and the client can render relative
 * times without re-hydrating a Date.
 */
export type NotificationView = {
	id: string;
	kind: string;
	title: string;
	body: string | null;
	href: string | null;
	readAt: string | null;
	createdAt: string;
	/** True for "starting soon" items, which have no persisted row. */
	derived?: boolean;
	/** Booking start, for derived items only. */
	startsAt?: string;
};

export type NotificationFeed = {
	items: NotificationView[];
	/** Derived, never persisted, and never counted in `unreadCount`. */
	startingSoon: NotificationView[];
	unreadCount: number;
};

export type NotifyInput = {
	userId: string;
	kind: string;
	title: string;
	body?: string | null;
	href?: string | null;
	dedupeKey: string;
};

export type NotifyResult = {
	/** False when the row already existed (dedupe) or notifications are off. */
	inserted: boolean;
	id: string | null;
	skipped?: boolean;
};

export type NotificationAttempt = NotifyResult & {
	ok: boolean;
	error?: string;
};

export type BookingNotifyResult = {
	/** False if any party's write failed. Never throws. */
	ok: boolean;
	attempts: NotificationAttempt[];
};

/**
 * Kill switch for the whole path. Acceptance requires that a missing or
 * disabled notification path never blocks a booking; deployments can therefore
 * turn the bell off without touching booking code.
 */
export function notificationsEnabled(): boolean {
	return process.env.NOTIFICATIONS_ENABLED !== "false";
}

/**
 * `booking:<id>:<event>:<party>`. Stable, and unique per recipient.
 *
 * Only persisted events are accepted here: "starting soon" is derived on read
 * and must never acquire a dedupe key, because it must never be persisted.
 */
export function bookingDedupeKey(
	bookingId: string,
	event: "confirmed" | "cancelled",
	party: "creator" | "customer",
): string {
	if (!bookingId?.trim()) {
		throw new ServiceError("INVALID_INPUT", "bookingId is required");
	}
	return `booking:${bookingId}:${event}:${party}`;
}

/** Only in-app routes are allowed; an external URL is dropped, never followed. */
function inAppHref(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
	return trimmed;
}

function requireUserId(userId: string): string {
	if (!userId?.trim()) {
		throw new ServiceError("INVALID_INPUT", "userId is required");
	}
	return userId;
}

/** Coerce an untrusted numeric option into a safe, bounded integer. */
function clampInt(
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toView(row: {
	id: string;
	kind: string;
	title: string;
	body: string | null;
	href: string | null;
	readAt: Date | null;
	createdAt: Date;
}): NotificationView {
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		body: row.body,
		href: row.href,
		readAt: row.readAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Insert one notification, idempotently.
 *
 * The unique `(user_id, dedupe_key)` constraint is the whole idempotency story:
 * `ON CONFLICT DO NOTHING` plus `RETURNING` reports whether this call was the one
 * that created the row. Two concurrent deliveries of the same event resolve in
 * the database, not in a read-then-write check.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
	const userId = requireUserId(input.userId);
	if (!input.dedupeKey?.trim()) {
		throw new ServiceError("INVALID_INPUT", "dedupeKey is required");
	}
	if (!input.kind?.trim() || !input.title?.trim()) {
		throw new ServiceError("INVALID_INPUT", "kind and title are required");
	}
	if (!notificationsEnabled()) {
		return { inserted: false, id: null, skipped: true };
	}

	const [row] = await db
		.insert(notifications)
		.values({
			userId,
			kind: input.kind,
			title: input.title,
			body: input.body ?? null,
			href: inAppHref(input.href),
			dedupeKey: input.dedupeKey,
		})
		// The unique constraint is on exactly these columns.
		.onConflictDoNothing({
			target: [notifications.userId, notifications.dedupeKey],
		})
		.returning({ id: notifications.id });

	return { inserted: Boolean(row), id: row?.id ?? null };
}

/**
 * `notify()` that never throws.
 *
 * Logs only the kind, the error class, and the driver's SQLSTATE when present.
 * The full driver message embeds the failed SQL and its parameters — which
 * include booking ids, titles, and the dedupe key — so it is deliberately not
 * logged: a failed bell is not worth writing booking detail into logs.
 */
export async function safeNotify(
	input: NotifyInput,
): Promise<NotificationAttempt> {
	try {
		const result = await notify(input);
		return { ...result, ok: true };
	} catch (error) {
		// Drizzle wraps the driver error, so the SQLSTATE sits on `cause`.
		const code =
			(error as { code?: unknown }).code ??
			(error as { cause?: { code?: unknown } }).cause?.code;
		console.error(
			`[notifications] write failed (${input.kind}):`,
			typeof code === "string" ? code : "unknown",
		);
		return {
			inserted: false,
			id: null,
			ok: false,
			error: error instanceof Error ? error.name : "Unknown error",
		};
	}
}

export type ListNotificationOptions = {
	limit?: number;
	offset?: number;
	/** Keyset cursor: return notifications strictly older than this instant. */
	before?: Date | string;
};

/** A user's own notifications, newest first. Always scoped by `userId`. */
export async function listNotifications(
	userId: string,
	options: ListNotificationOptions = {},
): Promise<NotificationView[]> {
	requireUserId(userId);
	const limit = clampInt(
		options.limit,
		DEFAULT_NOTIFICATION_LIMIT,
		1,
		MAX_NOTIFICATION_LIMIT,
	);
	const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
	const before = options.before ? new Date(options.before) : null;

	const filters = [eq(notifications.userId, userId)];
	if (before && !Number.isNaN(before.getTime())) {
		filters.push(lt(notifications.createdAt, before));
	}

	const rows = await db
		.select({
			id: notifications.id,
			kind: notifications.kind,
			title: notifications.title,
			body: notifications.body,
			href: notifications.href,
			readAt: notifications.readAt,
			createdAt: notifications.createdAt,
		})
		.from(notifications)
		.where(and(...filters))
		.orderBy(desc(notifications.createdAt))
		.limit(limit)
		.offset(offset);

	return rows.map(toView);
}

export async function unreadCount(userId: string): Promise<number> {
	requireUserId(userId);
	const [row] = await db
		.select({ value: count() })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
	return Number(row?.value ?? 0);
}

/**
 * Mark specific notifications read. Idempotent (already-read rows are skipped)
 * and scoped to the owning user, so a forged id can never touch someone else's
 * row. Returns how many rows actually changed.
 */
export async function markRead(
	userId: string,
	ids: readonly string[],
): Promise<number> {
	requireUserId(userId);
	// Bounded so a hostile caller cannot send an unbounded id list.
	const unique = [
		...new Set(ids.filter((id) => typeof id === "string" && id.trim())),
	].slice(0, MAX_NOTIFICATION_LIMIT);
	if (unique.length === 0) return 0;

	const rows = await db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notifications.userId, userId),
				inArray(notifications.id, unique),
				isNull(notifications.readAt),
			),
		)
		.returning({ id: notifications.id });
	return rows.length;
}

export async function markAllRead(userId: string): Promise<number> {
	requireUserId(userId);
	const rows = await db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
		.returning({ id: notifications.id });
	return rows.length;
}

function clampMinutes(value: number): number {
	return clampInt(value, STARTING_SOON_MINUTES, 1, 24 * 60);
}

/**
 * "Starting in N minutes" for this user, derived from booking times on read.
 *
 * These are never persisted, so they cannot go stale and need no scheduler. The
 * query itself enforces the acceptance rule: `status = 'confirmed'`, start is
 * strictly in the future, start is inside the window, and the booking has not
 * already ended. A cancelled or past booking cannot appear, even if a row was
 * somehow left behind.
 */
export async function notificationsStartingSoon(
	userId: string,
	now: Date = new Date(),
	withinMinutes: number = STARTING_SOON_MINUTES,
): Promise<NotificationView[]> {
	requireUserId(userId);
	const at = now instanceof Date ? now : new Date(now);
	if (Number.isNaN(at.getTime())) {
		throw new ServiceError("INVALID_INPUT", "now must be a valid instant");
	}
	const windowEnd = new Date(
		at.getTime() + clampMinutes(withinMinutes) * 60_000,
	);

	const rows = await db
		.select({
			bookingId: bookings.id,
			creatorId: bookings.creatorId,
			customerId: bookings.userId,
			startsAt: bookings.startsAt,
			scheduleName: bookingSchedules.name,
		})
		.from(bookings)
		.innerJoin(bookingSchedules, eq(bookingSchedules.id, bookings.scheduleId))
		.where(
			and(
				eq(bookings.status, "confirmed"),
				or(eq(bookings.creatorId, userId), eq(bookings.userId, userId)),
				gt(bookings.startsAt, at),
				lte(bookings.startsAt, windowEnd),
				gt(bookings.endsAt, at),
			),
		)
		.orderBy(bookings.startsAt)
		.limit(MAX_NOTIFICATION_LIMIT);

	return rows.map((row) => {
		const isCreator = row.creatorId === userId;
		const minutes = Math.max(
			1,
			Math.round((row.startsAt.getTime() - at.getTime()) / 60_000),
		);
		return {
			// Derived ids are stable while the window holds, but never persistable:
			// they must not be passed to `markRead`.
			id: `derived:${row.bookingId}:starting_soon:${isCreator ? "creator" : "customer"}`,
			kind: NOTIFICATION_KINDS.bookingStartingSoon,
			title: isCreator
				? `Booking starting in ${minutes} min`
				: `Your booking starts in ${minutes} min`,
			body: isCreator
				? `${row.scheduleName} · teaching session`
				: `${row.scheduleName} · get ready to join`,
			href: isCreator ? "/dashboard/creator" : "/dashboard",
			readAt: null,
			createdAt: at.toISOString(),
			derived: true,
			startsAt: row.startsAt.toISOString(),
		};
	});
}

function creditsLabel(units: number): string {
	return `${units} credit${units === 1 ? "" : "s"}`;
}

function formatWhen(value: Date | string, timeZone?: string | null): string {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "an upcoming time";
	const options: Intl.DateTimeFormatOptions = {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	};
	if (timeZone) {
		try {
			return new Intl.DateTimeFormat("en-US", {
				...options,
				timeZone,
			}).format(date);
		} catch {
			// An unknown IANA zone must not stop a notification from being written.
		}
	}
	// Never print an unlabeled local time; UTC is explicit.
	return new Intl.DateTimeFormat("en-US", {
		...options,
		timeZone: "UTC",
	}).format(date);
}

function creditSentence(
	party: "creator" | "customer",
	input: { chargedCredits?: number | null; restoredCredits?: number | null },
): string {
	const charged = Math.max(0, Math.trunc(input.chargedCredits ?? 0));
	const restored = Math.max(0, Math.trunc(input.restoredCredits ?? 0));

	if (restored > 0) {
		return party === "customer"
			? `${creditsLabel(restored)} returned to your balance.`
			: `${creditsLabel(restored)} were returned to the customer's balance.`;
	}
	if (charged > 0) {
		return party === "customer"
			? `${creditsLabel(charged)} were charged for this booking and not returned.`
			: `${creditsLabel(charged)} were charged to the customer and not returned.`;
	}
	return "No credits were charged for this booking.";
}

const DEFAULT_HREF = {
	creator: "/dashboard/creator",
	customer: "/dashboard",
} as const;

export type BookingConfirmedInput = {
	bookingId: string;
	creatorId: string;
	customerId: string;
	/** UTC instant. Displayed in `timeZone` when that is a valid IANA zone. */
	startsAt: Date | string;
	endsAt?: Date | string;
	durationMinutes?: number | null;
	scheduleName?: string | null;
	customerName?: string | null;
	creatorName?: string | null;
	/** The schedule's IANA zone, so copy never shows an unlabeled wall time. */
	timeZone?: string | null;
	chargedCredits?: number | null;
	/** Override the in-app route once a booking detail page exists. */
	href?: string | null;
};

export type BookingCancelledInput = BookingConfirmedInput & {
	/** Who cancelled. The other party reads "cancelled by …". */
	cancelledBy?: "creator" | "customer";
	/** Units actually restored, so the copy names what happened to credits. */
	restoredCredits?: number | null;
};

function partyUserIds(input: {
	creatorId: string;
	customerId: string;
}): { party: "creator" | "customer"; userId: string }[] {
	const parties: { party: "creator" | "customer"; userId: string }[] = [
		{ party: "creator", userId: input.creatorId },
		{ party: "customer", userId: input.customerId },
	];
	// Self-bookings notify once, not twice.
	const seen = new Set<string>();
	return parties.filter(({ userId }) => {
		if (!userId || seen.has(userId)) return false;
		seen.add(userId);
		return true;
	});
}

/**
 * Booking confirmed → creator and customer, once each.
 *
 * Intended call site: `lib/services/bookings.ts`, immediately AFTER the booking
 * row and its credit debit have committed (never inside the transaction, and
 * never awaited in a way that can fail the booking). Do not treat `ok: false` as
 * a booking failure — `safeNotify` already logs it.
 */
export async function notifyBookingConfirmed(
	input: BookingConfirmedInput,
): Promise<BookingNotifyResult> {
	return notifyParties(input, (party) => {
		const isCreator = party === "creator";
		const title = isCreator
			? `New booking${input.customerName ? ` from ${input.customerName}` : ""}`
			: `Booking confirmed${input.scheduleName ? `: ${input.scheduleName}` : ""}`;
		const when = formatWhen(input.startsAt, input.timeZone);
		const detail = isCreator
			? input.chargedCredits
				? `${when} · ${creditsLabel(Math.trunc(input.chargedCredits))} debited from the customer`
				: `${when} · free booking`
			: input.chargedCredits
				? `${when} · ${creditsLabel(Math.trunc(input.chargedCredits))} spent`
				: `${when} · free booking`;

		return {
			userId: isCreator ? input.creatorId : input.customerId,
			kind: NOTIFICATION_KINDS.bookingConfirmed,
			title,
			body: detail,
			href: input.href ?? DEFAULT_HREF[party],
			dedupeKey: bookingDedupeKey(input.bookingId, "confirmed", party),
		};
	});
}

/**
 * Booking cancelled → both parties, once each, with the credit outcome spelled
 * out. Cancellation is not a silent event: the party who did not cancel learns
 * who did, and both learn whether units came back.
 *
 * Intended call site: `lib/services/bookings.ts`, after the cancellation and the
 * restore have committed. Same failure policy as confirmation: never throw, never
 * roll back.
 */
export async function notifyBookingCancelled(
	input: BookingCancelledInput,
): Promise<BookingNotifyResult> {
	const cancelledBy = input.cancelledBy ?? null;
	return notifyParties(input, (party) => {
		const isCreator = party === "creator";
		const when = formatWhen(input.startsAt, input.timeZone);
		const actor =
			cancelledBy === null
				? "The booking"
				: cancelledBy === party
					? "You"
					: cancelledBy === "creator"
						? "The creator"
						: "The customer";
		const title =
			cancelledBy === party
				? `You cancelled a booking${input.scheduleName ? `: ${input.scheduleName}` : ""}`
				: `Booking cancelled${input.scheduleName ? `: ${input.scheduleName}` : ""}`;
		const body = `${actor} cancelled ${when}. ${creditSentence(party, {
			chargedCredits: input.chargedCredits,
			restoredCredits: input.restoredCredits,
		})}`;

		return {
			userId: isCreator ? input.creatorId : input.customerId,
			kind: NOTIFICATION_KINDS.bookingCancelled,
			title,
			body,
			href: input.href ?? DEFAULT_HREF[party],
			dedupeKey: bookingDedupeKey(input.bookingId, "cancelled", party),
		};
	});
}

/**
 * Shared plumbing for the two booking hooks. Deliberately never throws: copy
 * building, the database, and the kill switch are all inside the guard, because
 * a notification is never worth failing a booking over.
 */
async function notifyParties(
	input: { creatorId: string; customerId: string },
	build: (party: "creator" | "customer") => NotifyInput,
): Promise<BookingNotifyResult> {
	try {
		const attempts = await Promise.all(
			partyUserIds(input).map(({ party }) => safeNotify(build(party))),
		);
		return { ok: attempts.every((attempt) => attempt.ok), attempts };
	} catch (error) {
		console.error(
			"[notifications] booking notification failed:",
			error instanceof Error ? error.name : "Unknown error",
		);
		return { ok: false, attempts: [] };
	}
}
