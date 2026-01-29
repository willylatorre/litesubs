import { NextResponse } from "next/server";

export async function POST(request: Request) {
	const payload = await request.json();

	// TODO: Verify webhook signature once Cal.com webhook secret is configured.
	// TODO: Lookup subscription/product by event type and decrement credits.
	console.log("Received Cal.com webhook", payload);

	return NextResponse.json({ received: true });
}
