"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { calendarConnections } from "@/app/db/schema";
import {
	findActiveConnection,
	GOOGLE_CALENDAR_PROVIDER,
	retryCalendarSync,
} from "@/lib/google-calendar";
import { isTokenEncryptionConfigured } from "@/lib/google-calendar-crypto";
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
	calendarId: string | null;
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
					calendarId: null,
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
				calendarId: connection.calendarId,
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
		await db
			.update(calendarConnections)
			.set({
				disconnectedAt: new Date(),
				syncFailure: null,
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
		return { success: true };
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
