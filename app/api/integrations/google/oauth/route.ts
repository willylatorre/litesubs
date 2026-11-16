import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import {
	buildGoogleAuthUrl,
	encodeStateCookie,
	GOOGLE_OAUTH_STATE_COOKIE,
	readGoogleCalendarEnv,
} from "@/lib/google-calendar";
import { isTokenEncryptionConfigured } from "@/lib/google-calendar-crypto";

/**
 * Start the optional Google Calendar connection.
 *
 * Mirrors the Cal.com route: a random single-use `state`, bound to this browser
 * by an httpOnly cookie and only usable for the signed-in user who started the
 * flow. The callback compares the two before exchanging any code.
 */
export async function GET() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return NextResponse.redirect(
			appUrl("/dashboard/integrations?google=unauthenticated"),
		);
	}

	const env = readGoogleCalendarEnv();
	if (!env) {
		return NextResponse.redirect(
			appUrl("/dashboard/integrations?google=missing-config"),
		);
	}

	// Without a key we would have to store tokens in plaintext. Refuse instead.
	if (!isTokenEncryptionConfigured()) {
		return NextResponse.redirect(
			appUrl("/dashboard/integrations?google=missing-key"),
		);
	}

	const state = crypto.randomUUID();
	const response = NextResponse.redirect(buildGoogleAuthUrl(env, state));
	// Bound to this user: the callback re-checks both halves.
	response.cookies.set(
		GOOGLE_OAUTH_STATE_COOKIE,
		encodeStateCookie(session.user.id, state),
		{
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 60 * 10,
		},
	);

	return response;
}
