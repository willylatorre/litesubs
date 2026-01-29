import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/app/db";
import { calComAccounts } from "@/app/db/schema";
import { auth } from "@/lib/auth";
import { CAL_API_BASE_URL, refreshCalAccessToken } from "@/lib/cal-com";

export async function GET() {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const account = await db.query.calComAccounts.findFirst({
		where: eq(calComAccounts.userId, session.user.id),
	});

	if (!account) {
		return NextResponse.json({ connected: false, eventTypes: [] });
	}

	let activeAccount = account;
	if (account.expiresAt && account.expiresAt.getTime() < Date.now()) {
		try {
			activeAccount = await refreshCalAccessToken({
				id: account.id,
				refreshToken: account.refreshToken,
			});
		} catch (error) {
			console.error("Failed to refresh Cal.com access token", error);
			return NextResponse.json(
				{ error: "Cal.com access expired. Reconnect to continue." },
				{ status: 401 },
			);
		}
	}

	const response = await fetch(`${CAL_API_BASE_URL}/event-types`, {
		headers: {
			Authorization: `Bearer ${activeAccount.accessToken}`,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error("Failed to fetch Cal.com event types", errorText);
		return NextResponse.json(
			{ error: "Failed to fetch Cal.com event types" },
			{ status: 500 },
		);
	}

	const data = await response.json();
	const eventTypes = (data?.event_types || data?.data || data || []).map(
		(eventType: any) => ({
			id: eventType.id,
			slug: eventType.slug ?? eventType.eventTypeSlug ?? "",
			name: eventType.title ?? eventType.name ?? eventType.eventTypeTitle ?? "",
			url:
				eventType.bookingUrl ??
				eventType.url ??
				eventType.eventTypeUrl ??
				"",
		}),
	);

	return NextResponse.json({ connected: true, eventTypes });
}
