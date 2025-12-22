import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
	const sessionCookie = request.cookies.get("better-auth.session_token");

	if (!sessionCookie && request.nextUrl.pathname.startsWith("/dashboard")) {
		return NextResponse.redirect(new URL("/auth/sign-in", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/dashboard/:path*"],
};
