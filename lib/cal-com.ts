import { db } from "@/app/db";
import { calComAccounts } from "@/app/db/schema";
import { eq } from "drizzle-orm";

export const CAL_API_BASE_URL =
	process.env.CAL_API_BASE_URL ?? "https://api.cal.com/v2";
export const CAL_OAUTH_BASE_URL =
	process.env.CAL_OAUTH_BASE_URL ?? "https://cal.com/oauth";
export const CAL_OAUTH_SCOPE =
	process.env.CAL_OAUTH_SCOPE ?? "event_types:read bookings:read";
export const CAL_OAUTH_STATE_COOKIE = "cal_oauth_state";

export async function refreshCalAccessToken(account: {
	id: string;
	refreshToken: string | null;
}) {
	if (!process.env.CAL_CLIENT_ID || !process.env.CAL_CLIENT_SECRET) {
		throw new Error("Cal.com OAuth is not configured");
	}

	if (!account.refreshToken) {
		throw new Error("Missing Cal.com refresh token");
	}

	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: account.refreshToken,
		client_id: process.env.CAL_CLIENT_ID,
		client_secret: process.env.CAL_CLIENT_SECRET,
	});

	const response = await fetch(`${CAL_API_BASE_URL}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Failed to refresh Cal.com token: ${errorText}`);
	}

	const data = await response.json();
	const expiresAt = data.expires_in
		? new Date(Date.now() + Number(data.expires_in) * 1000)
		: null;

	const [updated] = await db
		.update(calComAccounts)
		.set({
			accessToken: data.access_token,
			refreshToken: data.refresh_token ?? account.refreshToken,
			expiresAt,
			scope: data.scope ?? null,
			updatedAt: new Date(),
		})
		.where(eq(calComAccounts.id, account.id))
		.returning();

	return updated;
}
