import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
	// Faster, less secure way to get session cookie
	const sessionCookie = getSessionCookie(request);

	// This is the recommended approach to optimistically redirect users
	// We recommend handling auth checks in each page/route
	if (!sessionCookie) {
		const callbackURL = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		return NextResponse.redirect(
			new URL(
				`/auth/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`,
				request.url,
			),
		);
	}

	return NextResponse.next();
}
