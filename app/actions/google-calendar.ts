"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { calendarConnections } from "@/app/db/schema";
import {
	createBookingCalendar,
	findActiveConnection,
	GOOGLE_CALENDAR_PROVIDER,
	listCalendars,
	retryCalendarSync,
	revokeGoogleToken,
	withCreatorAccessToken,
} from "@/lib/google-calendar";
import {
	decryptToken,
	isTokenEncryptionConfigured,
} from "@/lib/google-calendar-crypto";
import { authenticatedAction } from "@/lib/safe-action";

const INTEGRATIONS_PATH = "/dashboard/integrations";

export type GoogleCalendarStatus = {
	/** False when the connection is absent, disconnected, or never configured. */
	connected: boolean;
	/**
	 * False when the server has no OAuth client registered. The UI shows setup
	 * instructions instead of a Connect button that cannot work.
	 */
	configured: boolean;
	email: string | null;
	/** Whose busy time blocks slots. */
	busyCalendarId: string | null;
	/** Where booking events are written. */
	writeCalendarId: string | null;
	/** True when Litesubs created the write calendar. */
	writeCalendarCreated: boolean;
	scope: string | null;
	expiresAt: Date | null;
	lastSyncedAt: Date | null;
	/** A retryable, token-free explanation of the last failure. */
	syncFailure: string | null;
};

/**
 * Read the creator's connection state.
 *
 * This is an exported server action, so everything returned is serialized to
 * the client. Only display metadata is selected — never an encrypted token,
 * let alone a decrypted one.
 */
export async function getGoogleCalendarStatus() {
	return authenticatedAction<GoogleCalendarStatus>(async (session) => {
		const configured = Boolean(
			process.env.GOOGLE_CALENDAR_CLIENT_ID &&
				process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
				process.env.GOOGLE_CALENDAR_REDIRECT_URI &&
				isTokenEncryptionConfigured(),
		);

		const connection = await findActiveConnection(session.user.id);

		if (!connection) {
			return {
				success: true,
				data: {
					connected: false,
					configured,
					email: null,
					busyCalendarId: null,
					writeCalendarId: null,
					writeCalendarCreated: false,
					scope: null,
					expiresAt: null,
					lastSyncedAt: null,
					syncFailure: null,
				},
			};
		}

		return {
			success: true,
			data: {
				connected: true,
				configured,
				email: connection.externalAccountEmail,
				busyCalendarId: connection.busyCalendarId,
				writeCalendarId: connection.writeCalendarId,
				writeCalendarCreated: connection.writeCalendarCreated,
				scope: connection.scope,
				expiresAt: connection.expiresAt,
				lastSyncedAt: connection.lastSyncedAt,
				syncFailure: connection.syncFailure,
			},
		};
	});
}

/**
 * Stop syncing without touching anything else.
 *
 * Marking `disconnectedAt` (rather than deleting the row) keeps the previous
 * account email so the UI can say what was disconnected. Bookings are not
 * cancelled and credits are not revoked: this only stops best-effort sync.
 *
 * The encrypted tokens are cleared as well: a disconnected calendar must not
 * leave usable credentials at rest. Every read path already filters on
 * `disconnectedAt IS NULL`, so nothing depends on the retained value.
 */
export async function disconnectGoogleCalendar() {
	return authenticatedAction(async (session) => {
		const connection = await findActiveConnection(session.user.id);

		// Revoke at Google BEFORE erasing, because the token is the only thing that
		// can revoke it. Otherwise the app keeps access and remains in the
		// creator's Google permissions, which is not what "Disconnect" promises.
		let revoked = false;
		if (connection) {
			try {
				revoked = await revokeGoogleToken(
					decryptToken(connection.encryptedAccessToken),
				);
			} catch {
				// An unreadable token cannot be revoked; the local disconnect still
				// proceeds so the creator is never stuck connected.
				revoked = false;
			}
		}

		await db
			.update(calendarConnections)
			.set({
				disconnectedAt: new Date(),
				syncFailure: revoked
					? null
					: "Disconnected here, but Google did not confirm the revoke. Remove Litesubs from your Google account permissions to be certain.",
				encryptedAccessToken: "",
				encryptedRefreshToken: null,
				expiresAt: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(calendarConnections.creatorId, session.user.id),
					eq(calendarConnections.provider, GOOGLE_CALENDAR_PROVIDER),
				),
			);

		revalidatePath(INTEGRATIONS_PATH);
		return { success: true, revoked };
	});
}

/**
 * Clear a stale failure by performing one bounded free/busy read. This is the
 * "Retry" button. A failure is reported, never thrown.
 */
export async function retryGoogleCalendarSync() {
	return authenticatedAction(async (session) => {
		const result = await retryCalendarSync(session.user.id);
		revalidatePath(INTEGRATIONS_PATH);

		if (!result.ok) {
			return { error: syncFailureMessage(result.reason) };
		}

		return {
			success: true,
			data: { busyCount: result.data.busyCount },
		};
	});
}

/** Client-safe wording for a failed attempt. No token or provider text. */
function syncFailureMessage(reason: string): string {
	switch (reason) {
		case "not_connected":
			return "No Google Calendar is connected.";
		case "not_configured":
			return "Google Calendar is not configured on this server.";
		case "token_decrypt_failed":
			return "Stored credentials could not be read. Disconnect and reconnect.";
		case "refresh_failed":
			return "Google sign-in expired. Disconnect and reconnect.";
		case "unauthorized":
			return "Google denied access. Disconnect and reconnect.";
		case "timeout":
			return "Google Calendar did not answer in time. Try again.";
		case "network_error":
			return "Could not reach Google Calendar. Try again.";
		default:
			return "Google Calendar sync failed. Try again.";
	}
}

/* -------------------------------------------------------------------------- */
/* Choosing which calendars block and receive bookings                        */
/* -------------------------------------------------------------------------- */

/**
 * The calendars a creator can pick from, for the picker.
 *
 * Errors are returned as a message rather than thrown: a missing or expired
 * grant must render as "reconnect", not as a broken page.
 */
export async function listGoogleCalendars() {
	return authenticatedAction(async (session) => {
		const result = await withCreatorAccessToken(session.user.id, (token) =>
			listCalendars(token),
		);
		if (!result.ok)
			return { success: false, error: CALENDAR_ERROR_COPY[result.reason] };
		return { success: true, data: result.data };
	});
}

/**
 * Best-effort timezone for a new native schedule.
 *
 * Google's primary calendar is the creator's usual wall-clock zone. The chosen
 * write/busy calendars are fallbacks, and a provider failure returns null so
 * schedule creation can fall back to the browser instead of depending on Google.
 */
export async function getGoogleScheduleTimeZone() {
	return authenticatedAction<string | null>(async (session) => {
		const connection = await findActiveConnection(session.user.id);
		if (!connection) return { success: true, data: null };

		const result = await withCreatorAccessToken(session.user.id, (token) =>
			listCalendars(token),
		);
		if (!result.ok) return { success: true, data: null };

		const calendars = result.data;
		const primary = calendars.find((calendar) => calendar.primary);
		const write = calendars.find(
			(calendar) => calendar.id === connection.writeCalendarId,
		);
		const busy = calendars.find(
			(calendar) => calendar.id === connection.busyCalendarId,
		);
		return {
			success: true,
			data: primary?.timeZone ?? write?.timeZone ?? busy?.timeZone ?? null,
		};
	});
}

const CALENDAR_ERROR_COPY: Record<string, string> = {
	not_configured: "Google Calendar is not configured on this server.",
	not_connected: "Connect Google Calendar first.",
	unauthorized: "Google access expired. Reconnect Google Calendar.",
	refresh_failed: "Google access expired. Reconnect Google Calendar.",
	token_decrypt_failed: "The stored Google token is unreadable. Reconnect.",
	rate_limited: "Google is rate limiting requests. Try again shortly.",
	api_error: "Google did not respond. Try again shortly.",
	timeout: "Google took too long to respond. Try again.",
};

/**
 * Point each role at a calendar.
 *
 * Both ids are validated against the creator's own calendar list, so a value
 * from another account cannot be written. Changing these never re-authorises and
 * never moves existing bookings.
 */
export async function setGoogleCalendars(input: {
	busyCalendarId?: string;
	writeCalendarId?: string;
}) {
	return authenticatedAction(async (session) => {
		const connection = await findActiveConnection(session.user.id);
		if (!connection)
			return { success: false, error: "Connect Google Calendar first." };

		const listed = await withCreatorAccessToken(session.user.id, (token) =>
			listCalendars(token),
		);
		if (!listed.ok)
			return { success: false, error: CALENDAR_ERROR_COPY[listed.reason] };
		const allowed = new Set(listed.data.map((calendar) => calendar.id));

		const updates: {
			busyCalendarId?: string;
			writeCalendarId?: string;
			writeCalendarCreated?: boolean;
		} = {};
		if (input.busyCalendarId !== undefined) {
			if (!allowed.has(input.busyCalendarId))
				return { success: false, error: "Pick one of your own calendars." };
			updates.busyCalendarId = input.busyCalendarId;
		}
		if (input.writeCalendarId !== undefined) {
			if (!allowed.has(input.writeCalendarId))
				return { success: false, error: "Pick one of your own calendars." };
			const writable = listed.data.find(
				(calendar) => calendar.id === input.writeCalendarId,
			);
			if (!writable?.canWrite)
				return {
					success: false,
					error: "That calendar is read-only. Pick one you can write to.",
				};
			updates.writeCalendarId = input.writeCalendarId;
			// Pointing at an existing calendar means we no longer own it.
			updates.writeCalendarCreated = false;
		}

		await db
			.update(calendarConnections)
			.set({ ...updates, updatedAt: new Date() })
			.where(eq(calendarConnections.id, connection.id));
		revalidatePath(INTEGRATIONS_PATH);
		return { success: true };
	});
}

/**
 * Create a dedicated calendar and make it the write target.
 *
 * Offered because a creator usually does not want bookings flooding their
 * personal calendar. The created id is recorded as ours so disconnect can tell
 * the creator it exists.
 */
export async function createGoogleBookingCalendar(name?: string) {
	return authenticatedAction(async (session) => {
		const connection = await findActiveConnection(session.user.id);
		if (!connection)
			return { success: false, error: "Connect Google Calendar first." };

		const created = await withCreatorAccessToken(session.user.id, (token) =>
			createBookingCalendar(token, name?.trim() || undefined),
		);
		if (!created.ok)
			return { success: false, error: CALENDAR_ERROR_COPY[created.reason] };

		await db
			.update(calendarConnections)
			.set({
				writeCalendarId: created.data.id,
				writeCalendarCreated: true,
				updatedAt: new Date(),
			})
			.where(eq(calendarConnections.id, connection.id));
		revalidatePath(INTEGRATIONS_PATH);
		return { success: true, data: created.data };
	});
}
