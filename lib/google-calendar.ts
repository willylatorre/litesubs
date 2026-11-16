import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/app/db";
import { calendarConnections } from "@/app/db/schema";
import { decryptToken, encryptToken } from "@/lib/google-calendar-crypto";

/**
 * Optional Google Calendar sync.
 *
 * Everything in this module is BEST-EFFORT. A calendar failure must never roll
 * back a booking or a credit debit, so the booking-facing helpers swallow every
 * error and return a result object instead of throwing. The caller (booking /
 * cancellation code) treats a failed sync as informational and never undoes the
 * money movement it already committed.
 *
 * The native product works with all of this absent: no connection row means
 * every helper returns `not_connected` and does nothing else.
 *
 * Tokens are only ever held in memory here. They are encrypted with
 * {@link encryptToken} before storage, never returned to a client, and never
 * included in an error message or a log line.
 */

export const GOOGLE_OAUTH_AUTH_URL =
	"https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Revoking here removes Litesubs from the creator's Google account entirely. */
export const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API_BASE_URL =
	"https://www.googleapis.com/calendar/v3";
export const GOOGLE_CALENDAR_PROVIDER = "google";
export const GOOGLE_OAUTH_STATE_COOKIE = "google_calendar_oauth_state";

/**
 * The state cookie is `<userId>:<nonce>`. Keeping the user id inside the signed-
 * by-httpOnly cookie lets the callback prove the flow belongs to the account
 * that is finishing it, not merely to whatever browser holds the cookie.
 */
export function encodeStateCookie(userId: string, nonce: string): string {
	return `${userId}:${nonce}`;
}

export function parseStateCookie(
	value: string,
): { userId: string; nonce: string } | null {
	const separator = value.lastIndexOf(":");
	if (separator <= 0) return null;
	const userId = value.slice(0, separator);
	const nonce = value.slice(separator + 1);
	if (!userId || !nonce) return null;
	return { userId, nonce };
}

/**
 * Scopes, chosen narrowly but sufficient for the two-calendar model.
 *
 * - `freebusy.readonly` lets a chosen calendar block slots without exposing event
 *   titles or attendees.
 * - `calendar.events` writes booking events on a calendar the creator already
 *   owns.
 * - `calendar.app.created` lets us create a dedicated "Litesubs bookings"
 *   calendar, which a plain `calendar.events` grant cannot do.
 * - `calendar.calendarlist.readonly` is what makes "pick a calendar" possible:
 *   without it we cannot list what the creator has.
 *
 * Deliberately NOT requested: full `calendar` (which would expose every event's
 * contents) or `openid`/`email` (so Google returns no id_token and the
 * connection is labelled by calendar rather than account email).
 */
export const GOOGLE_CALENDAR_SCOPES = [
	"https://www.googleapis.com/auth/calendar.freebusy",
	"https://www.googleapis.com/auth/calendar.events",
	"https://www.googleapis.com/auth/calendar.app.created",
	"https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

/** Bounded timeout for every Google request. No request may hang a page. */
const REQUEST_TIMEOUT_MS = 8_000;

/** Refresh a little before actual expiry so a request cannot race the clock. */
const EXPIRY_SKEW_MS = 60_000;

export type GoogleCalendarEnv = {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
};

/** Read + validate the OAuth client configuration, or return `null`. */
export function readGoogleCalendarEnv(): GoogleCalendarEnv | null {
	const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
	const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
	const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
	if (!clientId || !clientSecret || !redirectUri) return null;
	return { clientId, clientSecret, redirectUri };
}

/* -------------------------------------------------------------------------- */
/* Pure interval math (unit-tested, no network, no database)                   */
/* -------------------------------------------------------------------------- */

export type TimePoint = Date | string | number;

export type IntervalLike = {
	start: TimePoint;
	end: TimePoint;
};

function toEpoch(value: TimePoint): number {
	const ms =
		value instanceof Date ? value.getTime() : new Date(value).getTime();
	if (!Number.isFinite(ms)) {
		throw new TypeError("Interval bound is not a valid instant");
	}
	return ms;
}

/** Like {@link toEpoch}, but returns `null` instead of throwing. */
function tryToEpoch(value: TimePoint): number | null {
	try {
		return toEpoch(value);
	} catch {
		return null;
	}
}

/** Normalize a busy/slot list to epoch milliseconds, dropping empty ranges. */
export function normalizeIntervals<T extends IntervalLike>(
	intervals: readonly T[],
): Array<{ start: number; end: number; source: T }> {
	const normalized: Array<{ start: number; end: number; source: T }> = [];
	for (const interval of intervals) {
		const start = toEpoch(interval.start);
		const end = toEpoch(interval.end);
		if (!(end > start)) continue;
		normalized.push({ start, end, source: interval });
	}
	return normalized;
}

/**
 * Remove candidate slots that overlap any busy interval.
 *
 * Semantics are half-open `[start, end)`:
 * - a busy block that merely touches a slot's boundary does not remove it
 *   (back-to-back meetings stay bookable);
 * - a fully-contained busy block removes the slot;
 * - a slot fully inside a busy block is removed;
 * - zero-length or inverted busy blocks are ignored.
 *
 * The returned slots are the caller's original objects, so extra fields (price,
 * label, id) survive. Order is preserved.
 *
 * A malformed candidate slot (an unparseable instant) is kept rather than
 * removed: this function must never make a slot disappear just because its own
 * math failed, and it must never throw while rendering availability.
 */
export function subtractBusyIntervals<T extends IntervalLike>(
	slots: readonly T[],
	busy: readonly IntervalLike[],
): T[] {
	const normalizedBusy: Array<{ start: number; end: number }> = [];
	for (const block of busy) {
		const start = tryToEpoch(block.start);
		const end = tryToEpoch(block.end);
		// Skip anything unusable rather than throwing: a malformed busy interval
		// must not break availability rendering.
		if (start === null || end === null || !(end > start)) continue;
		normalizedBusy.push({ start, end });
	}
	if (normalizedBusy.length === 0) return [...slots];

	return slots.filter((slot) => {
		const start = tryToEpoch(slot.start);
		const end = tryToEpoch(slot.end);
		if (start === null || end === null || !(end > start)) return true;
		return !normalizedBusy.some(
			(block) => block.start < end && block.end > start,
		);
	});
}

/* -------------------------------------------------------------------------- */
/* Types shared with the routes, actions and (eventually) the booking slice    */
/* -------------------------------------------------------------------------- */

export type GoogleTokenSet = {
	accessToken: string;
	/** Present on first consent and on some refreshes. Absent otherwise. */
	refreshToken: string | null;
	expiresAt: Date | null;
	scope: string | null;
	email: string | null;
};

export type GoogleSyncFailureReason =
	| "not_connected"
	| "not_configured"
	| "token_decrypt_failed"
	| "refresh_failed"
	| "unauthorized"
	| "rate_limited"
	| "timeout"
	| "network_error"
	| "api_error"
	| "invalid_response";

export type GoogleSyncResult<T> =
	| { ok: true; data: T }
	| { ok: false; reason: GoogleSyncFailureReason };

/* -------------------------------------------------------------------------- */
/* OAuth helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Build the consent URL. `state` is generated and cookie-bound by the route. */
export function buildGoogleAuthUrl(
	env: GoogleCalendarEnv,
	state: string,
): string {
	const url = new URL(GOOGLE_OAUTH_AUTH_URL);
	url.searchParams.set("client_id", env.clientId);
	url.searchParams.set("redirect_uri", env.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
	url.searchParams.set("state", state);
	// Offline + forced consent is the only reliable way to receive a refresh
	// token from Google on a reconnect.
	url.searchParams.set("access_type", "offline");
	url.searchParams.set("prompt", "consent");
	url.searchParams.set("include_granted_scopes", "false");
	return url.toString();
}

class TimeoutError extends Error {
	constructor() {
		super("Google request timed out");
		this.name = "TimeoutError";
	}
}

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, {
			...init,
			// Bounded: no request may hang a page. A caller cannot supply a signal,
			// so this timeout always applies.
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			cache: "no-store",
		});
	} catch (error) {
		// `AbortSignal.timeout` surfaces as a DOMException named "TimeoutError";
		// "AbortError" can come from the platform when the signal fires early.
		if (
			error instanceof Error &&
			(error.name === "TimeoutError" || error.name === "AbortError")
		) {
			throw new TimeoutError();
		}
		throw error;
	}
}

function parseExpiry(expiresIn: unknown): Date | null {
	const seconds = Number(expiresIn);
	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	return new Date(Date.now() + seconds * 1000);
}

/**
 * Google only returns an `id_token` when the `openid` scope is requested. We
 * deliberately request just `calendar.freebusy` and `calendar.events`, so no
 * account email is available from the token response and
 * `externalAccountEmail` stays `null`. That is a deliberate trade: no extra
 * identity scope just to render a label.
 */
function emailFromIdToken(idToken: unknown): string | null {
	if (typeof idToken !== "string") return null;
	const [, payload] = idToken.split(".");
	if (!payload) return null;
	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as { email?: unknown };
		return typeof claims.email === "string" ? claims.email : null;
	} catch {
		return null;
	}
}

function tokenSetFromResponse(payload: unknown): GoogleTokenSet {
	const data = (payload ?? {}) as Record<string, unknown>;
	const accessToken = data.access_token;
	if (typeof accessToken !== "string" || accessToken === "") {
		throw new Error("Google token response has no access token");
	}
	return {
		accessToken,
		refreshToken:
			typeof data.refresh_token === "string" && data.refresh_token !== ""
				? data.refresh_token
				: null,
		expiresAt: parseExpiry(data.expires_in),
		scope: typeof data.scope === "string" ? data.scope : null,
		email: emailFromIdToken(data.id_token),
	};
}

/** Exchange an authorization code. Throws on configuration/network failure. */
export async function exchangeGoogleCode(
	env: GoogleCalendarEnv,
	code: string,
): Promise<GoogleTokenSet> {
	const response = await googleFetch(GOOGLE_OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: env.redirectUri,
			client_id: env.clientId,
			client_secret: env.clientSecret,
		}),
	});

	if (!response.ok) {
		// Read and discard the body: it can echo request parameters, and nothing
		// from a token response belongs in a log line.
		await response.text().catch(() => "");
		throw new Error(`Google token exchange failed (${response.status})`);
	}

	return tokenSetFromResponse(await response.json());
}

/** Refresh an access token. Throws on failure; the caller records syncFailure. */
export async function refreshGoogleAccessToken(
	env: GoogleCalendarEnv,
	refreshToken: string,
): Promise<GoogleTokenSet> {
	const response = await googleFetch(GOOGLE_OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: env.clientId,
			client_secret: env.clientSecret,
		}),
	});

	if (!response.ok) {
		await response.text().catch(() => "");
		throw apiErrorForStatus(response.status);
	}

	return tokenSetFromResponse(await response.json());
}

/** Refresh an access token. Throws on failure; the caller records syncFailure. */

/* -------------------------------------------------------------------------- */
/* Free/busy + events (network only; no database access)                      */
/* -------------------------------------------------------------------------- */

export type BusyInterval = { start: Date; end: Date };

export type FreeBusyQuery = {
	calendarId: string;
	timeMin: Date;
	timeMax: Date;
	timeZone?: string;
};

/** Query busy intervals in UTC. Throws {@link TimeoutError} or an API error. */
export async function queryFreeBusy(
	accessToken: string,
	query: FreeBusyQuery,
): Promise<BusyInterval[]> {
	const response = await googleFetch(
		`${GOOGLE_CALENDAR_API_BASE_URL}/freeBusy`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				timeMin: query.timeMin.toISOString(),
				timeMax: query.timeMax.toISOString(),
				timeZone: query.timeZone ?? "UTC",
				items: [{ id: query.calendarId }],
			}),
		},
	);

	if (!response.ok) {
		throw apiErrorForStatus(response.status);
	}

	const payload = (await response.json()) as {
		calendars?: Record<
			string,
			{ busy?: Array<{ start?: string; end?: string }> }
		>;
	};
	const calendar = payload.calendars?.[query.calendarId];
	if (!calendar) return [];

	const busy: BusyInterval[] = [];
	for (const interval of calendar.busy ?? []) {
		if (!interval.start || !interval.end) continue;
		const start = new Date(interval.start);
		const end = new Date(interval.end);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
		if (end <= start) continue;
		busy.push({ start, end });
	}
	return busy;
}

/**
 * Map a Google HTTP status to the typed failure reason. `rate_limited` is kept
 * distinct so the UI can suggest "try shortly" rather than "reconnect".
 */
function apiErrorForStatus(status: number): GoogleApiError {
	if (status === 401 || status === 403) {
		return new GoogleApiError("unauthorized", status);
	}
	if (status === 429) {
		return new GoogleApiError("rate_limited", status);
	}
	return new GoogleApiError("api_error", status);
}

export class GoogleApiError extends Error {
	readonly reason: GoogleSyncFailureReason;
	readonly status: number;

	constructor(reason: GoogleSyncFailureReason, status: number) {
		super(`Google Calendar request failed (${status})`);
		this.name = "GoogleApiError";
		this.reason = reason;
		this.status = status;
	}
}

export type CalendarEventInput = {
	calendarId: string;
	summary: string;
	description?: string;
	start: Date;
	end: Date;
	timeZone?: string;
	/** Used as an idempotency key in extended properties. */
	bookingId?: string;
	attendeeEmail?: string | null;
};

/**
 * Create an event. Returns the Google event id, which the caller may store to
 * delete the event later. Throws on failure — the best-effort wrapper below
 * never propagates it.
 */
export async function createCalendarEvent(
	accessToken: string,
	input: CalendarEventInput,
): Promise<string> {
	const response = await googleFetch(
		`${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(
			input.calendarId,
		)}/events`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				summary: input.summary,
				description: input.description,
				start: {
					dateTime: input.start.toISOString(),
					timeZone: input.timeZone ?? "UTC",
				},
				end: {
					dateTime: input.end.toISOString(),
					timeZone: input.timeZone ?? "UTC",
				},
				attendees: input.attendeeEmail
					? [{ email: input.attendeeEmail }]
					: undefined,
				extendedProperties: input.bookingId
					? { private: { litesubsBookingId: input.bookingId } }
					: undefined,
			}),
		},
	);

	if (!response.ok) {
		throw apiErrorForStatus(response.status);
	}

	const payload = (await response.json()) as { id?: string };
	if (!payload.id)
		throw new GoogleApiError("invalid_response", response.status);
	return payload.id;
}

/** Delete an event. A 404/410 is treated as already gone. Throws otherwise. */
export async function deleteCalendarEvent(
	accessToken: string,
	calendarId: string,
	eventId: string,
): Promise<void> {
	const response = await googleFetch(
		`${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(
			calendarId,
		)}/events/${encodeURIComponent(eventId)}`,
		{
			method: "DELETE",
			headers: { Authorization: `Bearer ${accessToken}` },
		},
	);

	if (response.ok || response.status === 404 || response.status === 410) return;
	throw apiErrorForStatus(response.status);
}

/* -------------------------------------------------------------------------- */
/* Database-backed connection handling                                        */
/* -------------------------------------------------------------------------- */

type ConnectionRow = typeof calendarConnections.$inferSelect;

/** The creator's live (not disconnected) connection row, if any. */
export async function findActiveConnection(
	creatorId: string,
): Promise<ConnectionRow | null> {
	const row = await db.query.calendarConnections.findFirst({
		where: and(
			eq(calendarConnections.creatorId, creatorId),
			eq(calendarConnections.provider, GOOGLE_CALENDAR_PROVIDER),
			isNull(calendarConnections.disconnectedAt),
		),
	});
	return row ?? null;
}

function reasonFromError(error: unknown): GoogleSyncFailureReason {
	if (
		error instanceof TimeoutError ||
		(error instanceof Error && error.name === "TimeoutError")
	) {
		return "timeout";
	}
	if (error instanceof GoogleApiError) return error.reason;
	if (
		error instanceof Error &&
		/ECONN|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(error.message)
	) {
		return "network_error";
	}
	return "api_error";
}

/**
 * Human-safe, token-free description stored in `syncFailure` and shown in the
 * UI. Deliberately a fixed string per reason: no provider error text is copied,
 * because provider errors can echo request details.
 */
export function describeSyncFailure(reason: GoogleSyncFailureReason): string {
	switch (reason) {
		case "not_connected":
			return "No calendar is connected.";
		case "not_configured":
			return "Google Calendar is not configured on this server.";
		case "token_decrypt_failed":
			return "Stored Google credentials could not be read. Reconnect the calendar.";
		case "refresh_failed":
			return "Google sign-in expired. Reconnect the calendar.";
		case "unauthorized":
			return "Google denied access. Reconnect the calendar.";
		case "rate_limited":
			return "Google Calendar is rate limiting. Try again shortly.";
		case "timeout":
			return "Google Calendar did not answer in time. Try again.";
		case "network_error":
			return "Could not reach Google Calendar. Try again.";
		case "invalid_response":
			return "Google Calendar returned an unexpected response. Try again.";
		case "api_error":
			return "Google Calendar sync failed. Try again.";
	}
}

async function markSyncFailure(
	connectionId: string,
	reason: GoogleSyncFailureReason,
): Promise<void> {
	try {
		await db
			.update(calendarConnections)
			.set({
				syncFailure: describeSyncFailure(reason),
				updatedAt: new Date(),
			})
			.where(eq(calendarConnections.id, connectionId));
	} catch {
		// Recording a failure must itself never fail the caller.
	}
}

async function markSyncSuccess(connectionId: string): Promise<void> {
	try {
		await db
			.update(calendarConnections)
			.set({
				syncFailure: null,
				lastSyncedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(calendarConnections.id, connectionId));
	} catch {
		// Non-fatal.
	}
}

type AccessTokenResult =
	| {
			ok: true;
			accessToken: string;
			/** Whose busy time blocks slots. */
			busyCalendarId: string;
			/** Where booking events are written. */
			writeCalendarId: string;
			connectionId: string;
	  }
	| { ok: false; reason: GoogleSyncFailureReason };

/**
 * Resolve a usable access token for a creator: decrypt, refresh if expired, and
 * persist the rotated token. Never throws; failures become `{ ok: false }` and
 * are recorded in `syncFailure`.
 */
async function resolveAccessToken(
	creatorId: string,
	options: { record?: boolean } = {},
): Promise<AccessTokenResult> {
	const record = options.record ?? true;
	const env = readGoogleCalendarEnv();
	if (!env) return { ok: false, reason: "not_configured" };

	let connection: ConnectionRow | null;
	try {
		connection = await findActiveConnection(creatorId);
	} catch {
		return { ok: false, reason: "api_error" };
	}
	if (!connection) return { ok: false, reason: "not_connected" };

	let accessToken: string;
	try {
		accessToken = decryptToken(connection.encryptedAccessToken);
	} catch {
		if (record) await markSyncFailure(connection.id, "token_decrypt_failed");
		return { ok: false, reason: "token_decrypt_failed" };
	}

	const expiresSoon =
		connection.expiresAt !== null &&
		connection.expiresAt.getTime() - EXPIRY_SKEW_MS <= Date.now();

	if (!expiresSoon) {
		return {
			ok: true,
			accessToken,
			busyCalendarId: connection.busyCalendarId,
			writeCalendarId: connection.writeCalendarId,
			connectionId: connection.id,
		};
	}

	if (!connection.encryptedRefreshToken) {
		if (record) await markSyncFailure(connection.id, "refresh_failed");
		return { ok: false, reason: "refresh_failed" };
	}

	let refreshToken: string;
	try {
		refreshToken = decryptToken(connection.encryptedRefreshToken);
	} catch {
		if (record) await markSyncFailure(connection.id, "token_decrypt_failed");
		return { ok: false, reason: "token_decrypt_failed" };
	}

	// A refresh must be persisted regardless of `record`: leaving a stale
	// encrypted access token behind would make the next call refresh again.
	try {
		const refreshed = await refreshGoogleAccessToken(env, refreshToken);
		accessToken = refreshed.accessToken;
		await db
			.update(calendarConnections)
			.set({
				encryptedAccessToken: encryptToken(refreshed.accessToken),
				encryptedRefreshToken: encryptToken(
					refreshed.refreshToken ?? refreshToken,
				),
				expiresAt: refreshed.expiresAt,
				scope: refreshed.scope ?? connection.scope,
				syncFailure: null,
				updatedAt: new Date(),
			})
			.where(eq(calendarConnections.id, connection.id));
	} catch {
		if (record) await markSyncFailure(connection.id, "refresh_failed");
		return { ok: false, reason: "refresh_failed" };
	}

	return {
		ok: true,
		accessToken,
		busyCalendarId: connection.busyCalendarId,
		writeCalendarId: connection.writeCalendarId,
		connectionId: connection.id,
	};
}

/**
 * Run `fn` with a valid access token.
 *
 * There are no retries in this module: one attempt, and a 401 becomes a typed
 * `unauthorized` failure the creator can act on by reconnecting. `record: false`
 * is used on read-only paths (rendering availability) so a public page never
 * writes to the connection row.
 */
/**
 * Run a calendar call with a resolved token.
 *
 * Exported for the "choose your calendars" actions, which need to list and
 * create calendars rather than read busy time. Same token resolution, same
 * bounded requests, same failure typing as every sync path.
 */
export async function withCreatorAccessToken<T>(
	creatorId: string,
	fn: (accessToken: string) => Promise<T>,
): Promise<GoogleSyncResult<T>> {
	return withAccessToken(creatorId, (accessToken) => fn(accessToken), {
		record: false,
	});
}

async function withAccessToken<T>(
	creatorId: string,
	fn: (
		accessToken: string,
		calendar: { busyCalendarId: string; writeCalendarId: string },
	) => Promise<T>,
	options: { record?: boolean } = {},
): Promise<GoogleSyncResult<T>> {
	const record = options.record ?? true;
	const token = await resolveAccessToken(creatorId, { record });
	if (!token.ok) return { ok: false, reason: token.reason };

	try {
		const data = await fn(token.accessToken, {
			busyCalendarId: token.busyCalendarId,
			writeCalendarId: token.writeCalendarId,
		});
		if (record) await markSyncSuccess(token.connectionId);
		return { ok: true, data };
	} catch (error) {
		const reason = reasonFromError(error);
		if (record) await markSyncFailure(token.connectionId, reason);
		return { ok: false, reason };
	}
}

/**
 * Busy intervals for a creator, or a typed failure. The caller degrades to
 * "calendar not synced" and shows the slots it computed natively.
 *
 * Read-only: nothing is written to the connection row, so rendering a public
 * booking page does not mutate state. Failures surface in the UI via the
 * connection's existing `syncFailure`, and the explicit retry action records new
 * ones.
 */
export async function getCreatorBusyIntervals(
	creatorId: string,
	range: { from: Date; to: Date },
): Promise<GoogleSyncResult<BusyInterval[]>> {
	return withAccessToken(
		creatorId,
		(accessToken, calendar) =>
			queryFreeBusy(accessToken, {
				// The creator's own calendar is what makes them unavailable.
				calendarId: calendar.busyCalendarId,
				timeMin: range.from,
				timeMax: range.to,
			}),
		{ record: false },
	);
}

/**
 * Compute bookable slots minus Google busy time. If the calendar is missing or
 * failing, the native slots are returned unchanged — availability never depends
 * on Google.
 */
export async function filterSlotsByCalendar<T extends IntervalLike>(
	creatorId: string,
	slots: readonly T[],
	range: { from: Date; to: Date },
): Promise<T[]> {
	const result = await getCreatorBusyIntervals(creatorId, range);
	if (!result.ok) return [...slots];
	return subtractBusyIntervals(slots, result.data);
}

export type BookingCalendarEvent = {
	bookingId: string;
	summary: string;
	description?: string;
	start: Date;
	end: Date;
	timeZone?: string;
	attendeeEmail?: string | null;
};

/**
 * Create a booking's calendar event. NEVER throws: a booking has already been
 * committed (and its credits debited) by the time this runs, so a Google failure
 * is recorded as `syncFailure` and reported as `{ ok: false }`. Callers must not
 * roll anything back on failure.
 *
 * The booking slice persists the returned `eventId` (on
 * `bookings.external_event_id`) so {@link bestEffortDeleteBookingEvent} can find
 * the event later. If the id is missing, cancellation simply skips the delete.
 */
export async function bestEffortCreateBookingEvent(
	creatorId: string,
	event: BookingCalendarEvent,
): Promise<GoogleSyncResult<{ eventId: string }>> {
	try {
		return await withAccessToken(creatorId, async (accessToken, calendar) => {
			const eventId = await createCalendarEvent(accessToken, {
				calendarId: calendar.writeCalendarId,
				summary: event.summary,
				description: event.description,
				start: event.start,
				end: event.end,
				timeZone: event.timeZone,
				bookingId: event.bookingId,
				attendeeEmail: event.attendeeEmail,
			});
			return { eventId };
		});
	} catch {
		return { ok: false, reason: "api_error" };
	}
}

/**
 * Delete a booking's calendar event on cancellation. NEVER throws, and a missing
 * event is a success (already cancelled/never created). Cancellation of the
 * booking and restoration of credits happen regardless of this result.
 */
export async function bestEffortDeleteBookingEvent(
	creatorId: string,
	eventId: string,
): Promise<GoogleSyncResult<{ deleted: boolean }>> {
	try {
		return await withAccessToken(creatorId, async (accessToken, calendar) => {
			await deleteCalendarEvent(accessToken, calendar.writeCalendarId, eventId);
			return { deleted: true };
		});
	} catch {
		return { ok: false, reason: "api_error" };
	}
}

/**
 * Validate the connection by issuing a small free/busy read. Used by the
 * "retry" button so a creator can clear a stale `syncFailure` without waiting
 * for their next booking.
 */
export async function retryCalendarSync(
	creatorId: string,
): Promise<GoogleSyncResult<{ busyCount: number }>> {
	const now = new Date();
	return withAccessToken(creatorId, async (accessToken, calendar) => {
		const busy = await queryFreeBusy(accessToken, {
			calendarId: calendar.busyCalendarId,
			timeMin: now,
			timeMax: new Date(now.getTime() + 24 * 60 * 60 * 1000),
		});
		return { busyCount: busy.length };
	});
}

/* -------------------------------------------------------------------------- */
/* Choosing calendars                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Ask Google to revoke this grant.
 *
 * Without this, "Disconnect" only forgets the tokens locally: the app keeps its
 * access and stays in the creator's Google account permissions, which is not what
 * disconnecting means to a person.
 *
 * Best-effort by design. A network failure must not stop the local disconnect,
 * because the creator asked for the connection to be gone and the tokens are
 * erased regardless. Returns whether Google confirmed the revoke so the UI can be
 * honest about it.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
	try {
		const response = await googleFetch(GOOGLE_OAUTH_REVOKE_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ token }).toString(),
		});
		// Google answers 200 on success and 400 for an already-invalid token;
		// the latter is not a failure of intent.
		return response.ok || response.status === 400;
	} catch {
		return false;
	}
}

export type CalendarSummary = {
	id: string;
	summary: string;
	primary: boolean;
	/** Whether the creator can write events here, per Google's accessRole. */
	canWrite: boolean;
};

/**
 * The calendars a creator can choose from.
 *
 * Read-only and bounded: this is used to populate a picker, never on a booking
 * path. Throws on failure so the caller can show a retryable message; it is not
 * part of any money-moving flow.
 */
export async function listCalendars(
	accessToken: string,
): Promise<CalendarSummary[]> {
	const response = await googleFetch(
		`${GOOGLE_CALENDAR_API_BASE_URL}/users/me/calendarList?minAccessRole=reader&maxResults=250`,
		{
			method: "GET",
			headers: { Authorization: `Bearer ${accessToken}` },
		},
	);
	const payload = (await response.json()) as {
		items?: {
			id?: unknown;
			summary?: unknown;
			primary?: unknown;
			accessRole?: unknown;
		}[];
	};
	return (payload.items ?? [])
		.filter((item): item is { id: string } => typeof item.id === "string")
		.map((item) => {
			const record = item as {
				id: string;
				summary?: unknown;
				primary?: unknown;
				accessRole?: unknown;
			};
			return {
				id: record.id,
				summary:
					typeof record.summary === "string" ? record.summary : record.id,
				primary: record.primary === true,
				canWrite:
					record.accessRole === "owner" || record.accessRole === "writer",
			};
		});
}

/**
 * Create a dedicated calendar for bookings.
 *
 * Only used when the creator asks for a new calendar rather than picking an
 * existing one. The id is returned so it can be stored as the write target.
 */
export async function createBookingCalendar(
	accessToken: string,
	name = "Litesubs bookings",
): Promise<{ id: string; summary: string }> {
	const response = await googleFetch(
		`${GOOGLE_CALENDAR_API_BASE_URL}/calendars`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ summary: name, timeZone: "UTC" }),
		},
	);
	const payload = (await response.json()) as {
		id?: unknown;
		summary?: unknown;
	};
	if (typeof payload.id !== "string")
		throw new GoogleApiError("api_error", response.status);
	return {
		id: payload.id,
		summary: typeof payload.summary === "string" ? payload.summary : name,
	};
}
