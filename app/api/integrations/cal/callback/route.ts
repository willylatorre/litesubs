import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/app/db";
import { calComAccounts } from "@/app/db/schema";
import { auth } from "@/lib/auth";
import {
	CAL_API_BASE_URL,
	CAL_OAUTH_STATE_COOKIE,
} from "@/lib/cal-com";

export async function GET(request: Request) {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { searchParams } = new URL(request.url);
	const code = searchParams.get("code");
	const state = searchParams.get("state");
	const storedState = cookies().get(CAL_OAUTH_STATE_COOKIE)?.value;

	if (!code || !state || !storedState || state !== storedState) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?cal=error", request.url),
		);
	}

	if (
		!process.env.CAL_CLIENT_ID ||
		!process.env.CAL_CLIENT_SECRET ||
		!process.env.CAL_REDIRECT_URI
	) {
		return NextResponse.redirect(
			new URL("/dashboard/integrations?cal=missing-config", request.url),
		);
	}

	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		redirect_uri: process.env.CAL_REDIRECT_URI,
		client_id: process.env.CAL_CLIENT_ID,
		client_secret: process.env.CAL_CLIENT_SECRET,
	});

	const tokenResponse = await fetch(`${CAL_API_BASE_URL}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});

	if (!tokenResponse.ok) {
		const errorText = await tokenResponse.text();
		console.error("Cal.com token exchange failed", errorText);
		return NextResponse.redirect(
			new URL("/dashboard/integrations?cal=token-error", request.url),
		);
	}

	const tokenData = await tokenResponse.json();
	const expiresAt = tokenData.expires_in
		? new Date(Date.now() + Number(tokenData.expires_in) * 1000)
		: null;

	let calUserId: string | null = null;
	let calUsername: string | null = null;

	try {
		const meResponse = await fetch(`${CAL_API_BASE_URL}/me`, {
			headers: {
				Authorization: `Bearer ${tokenData.access_token}`,
			},
		});

		if (meResponse.ok) {
			const meData = await meResponse.json();
			calUserId = meData?.id ? String(meData.id) : null;
			calUsername = meData?.username ?? null;
		}
	} catch (error) {
		console.error("Failed to fetch Cal.com user profile", error);
	}

	await db
		.insert(calComAccounts)
		.values({
			userId: session.user.id,
			accessToken: tokenData.access_token,
			refreshToken: tokenData.refresh_token ?? null,
			expiresAt,
			scope: tokenData.scope ?? null,
			calUserId,
			calUsername,
		})
		.onConflictDoUpdate({
			target: calComAccounts.userId,
			set: {
				accessToken: tokenData.access_token,
				refreshToken: tokenData.refresh_token ?? null,
				expiresAt,
				scope: tokenData.scope ?? null,
				calUserId,
				calUsername,
				updatedAt: new Date(),
			},
		});

	const response = NextResponse.redirect(
		new URL("/dashboard/integrations?cal=connected", request.url),
	);
	response.cookies.delete(CAL_OAUTH_STATE_COOKIE);
	return response;
}
