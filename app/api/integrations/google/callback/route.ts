import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/app/db";
import { calendarConnections } from "@/app/db/schema";
import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import {
	exchangeGoogleCode,
	GOOGLE_CALENDAR_PROVIDER,
	GOOGLE_OAUTH_STATE_COOKIE,
	parseStateCookie,
	queryFreeBusy,
	readGoogleCalendarEnv,
} from "@/lib/google-calendar";
import {
	encryptToken,
	isTokenEncryptionConfigured,
	secureEquals,
} from "@/lib/google-calendar-crypto";

/** Where the browser lands, with a machine-readable result. */
function result(kind: string) {
	return appUrl(`/dashboard/integrations?google=${encodeURIComponent(kind)}`);
}

/**
 * OAuth callback for the optional Google Calendar connection.
 *
 * The state cookie carries `<userId>:<nonce>`. Both halves must match: the nonce
 * against the `state` query parameter, and the user id against the session that
 * is signed in *now*. That binds the callback to the account that started the
 * flow, so a leaked callback URL cannot attach a calendar to somebody else.
 *
 * The cookie is deleted on every exit path, success included, so a replayed
 * callback finds no state and is rejected.
 */
export async function GET(request: Request) {
	const cookieStore = await cookies();
	const storedCookie = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
	const stored = storedCookie ? parseStateCookie(storedCookie) : null;

	const session = await auth.api.getSession({
		headers: await headers(),
	});

	const { searchParams } = new URL(request.url);
	const state = searchParams.get("state");
	const error = searchParams.get("error");
	const code = searchParams.get("code");

	// Every path deletes the state cookie: it is single-use.
	const finish = (kind: string) => {
		const response = NextResponse.redirect(result(kind));
		response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
		return response;
	};

	if (!session?.user) return finish("unauthenticated");

	// Validate state before trusting anything else in the query string,
	// including Google's own `error` parameter.
	if (!stored || !state || !secureEquals(state, stored.nonce)) {
		// Missing, expired (10 min), or mismatched state. Do not exchange a code.
		return finish("state-mismatch");
	}
	if (!secureEquals(session.user.id, stored.userId)) {
		// The flow was started by a different account in this browser. Refuse
		// rather than silently attaching a calendar to the wrong creator.
		return finish("state-mismatch");
	}

	// Google reports a denial (or any other failure) as `error` + `state`.
	if (error) {
		return finish(error === "access_denied" ? "denied" : "error");
	}
	if (!code) return finish("state-mismatch");

	const env = readGoogleCalendarEnv();
	if (!env) return finish("missing-config");
	if (!isTokenEncryptionConfigured()) return finish("missing-key");

	let tokens: Awaited<ReturnType<typeof exchangeGoogleCode>>;
	try {
		tokens = await exchangeGoogleCode(env, code);
	} catch {
		// The thrown message never contains the code or token material; the
		// redirect is the only signal the user gets.
		return finish("token-error");
	}

	let encryptedAccessToken: string;
	let encryptedRefreshToken: string | null = null;
	try {
		encryptedAccessToken = encryptToken(tokens.accessToken);
		if (tokens.refreshToken) {
			encryptedRefreshToken = encryptToken(tokens.refreshToken);
		}
	} catch {
		// Fail closed: no key means no plaintext fallback.
		return finish("missing-key");
	}

	const calendarId = "primary";

	// Probe free/busy once so "connected" means "actually usable". A failure is
	// recorded but still keeps the connection: sync is best-effort.
	let syncFailure: string | null = null;
	try {
		await queryFreeBusy(tokens.accessToken, {
			calendarId,
			timeMin: new Date(),
			timeMax: new Date(Date.now() + 60 * 60 * 1000),
		});
	} catch {
		syncFailure =
			"Connected, but a test calendar read failed. Try syncing again shortly.";
	}

	const existing = await db.query.calendarConnections.findFirst({
		where: and(
			eq(calendarConnections.creatorId, session.user.id),
			eq(calendarConnections.provider, GOOGLE_CALENDAR_PROVIDER),
		),
	});

	// A reconnect may omit the refresh token (Google only reissues it on a full
	// consent). Keep the previous one rather than losing offline access.
	const refreshTokenToStore =
		encryptedRefreshToken ?? existing?.encryptedRefreshToken ?? null;

	// Only advance `lastSyncedAt` on a successful probe; a failed reconnect must
	// not erase the timestamp of the last good sync.
	const lastSyncedAt = syncFailure
		? (existing?.lastSyncedAt ?? null)
		: new Date();

	await db
		.insert(calendarConnections)
		.values({
			creatorId: session.user.id,
			provider: GOOGLE_CALENDAR_PROVIDER,
			externalAccountEmail: tokens.email,
			encryptedAccessToken,
			encryptedRefreshToken: refreshTokenToStore,
			expiresAt: tokens.expiresAt,
			scope: tokens.scope,
			calendarId,
			lastSyncedAt,
			syncFailure,
			disconnectedAt: null,
		})
		.onConflictDoUpdate({
			target: [calendarConnections.creatorId, calendarConnections.provider],
			set: {
				externalAccountEmail:
					tokens.email ?? existing?.externalAccountEmail ?? null,
				encryptedAccessToken,
				encryptedRefreshToken: refreshTokenToStore,
				expiresAt: tokens.expiresAt,
				scope: tokens.scope,
				calendarId,
				lastSyncedAt,
				syncFailure,
				// Reconnecting resumes sync.
				disconnectedAt: null,
				updatedAt: new Date(),
			},
		});

	if (refreshTokenToStore === null) {
		// Without a refresh token the connection dies within the hour. Say so
		// instead of pretending it is healthy.
		return finish("reconnect-needed");
	}

	return finish(syncFailure ? "connected-with-warning" : "connected");
}
