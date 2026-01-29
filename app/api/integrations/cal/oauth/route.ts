import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
	CAL_OAUTH_BASE_URL,
	CAL_OAUTH_SCOPE,
	CAL_OAUTH_STATE_COOKIE,
} from "@/lib/cal-com";

export async function GET() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (!process.env.CAL_CLIENT_ID || !process.env.CAL_REDIRECT_URI) {
		return NextResponse.json(
			{ error: "Cal.com OAuth is not configured" },
			{ status: 500 },
		);
	}

	const state = crypto.randomUUID();
	const authUrl = new URL(`${CAL_OAUTH_BASE_URL}/authorize`);
	authUrl.searchParams.set("client_id", process.env.CAL_CLIENT_ID);
	authUrl.searchParams.set("redirect_uri", process.env.CAL_REDIRECT_URI);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("scope", CAL_OAUTH_SCOPE);
	authUrl.searchParams.set("state", state);

	const response = NextResponse.redirect(authUrl.toString());
	response.cookies.set(CAL_OAUTH_STATE_COOKIE, state, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: 60 * 10,
	});

	return response;
}
