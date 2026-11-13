import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
	CREDIT_RESTORING_TRIGGERS,
	CREDIT_SPENDING_TRIGGERS,
	readCalBooking,
	readCalTrigger,
} from "@/lib/cal-webhook";
import {
	chargeCalBooking,
	restoreCalBooking,
} from "@/lib/services/cal-bookings";

const SIGNATURE_HEADER = "x-cal-signature-256";
const UNSIGNED_MARKER = "no-secret-provided";

/**
 * Verify a Cal.com webhook signature.
 *
 * Cal.com sends a plain lowercase-hex HMAC-SHA256 of the exact request body in
 * `X-Cal-Signature-256`. It is not prefixed, carries no timestamp, and is not
 * Standard Webhooks. When no secret is configured on the webhook, the header is
 * still sent with the literal value "no-secret-provided" — that must be treated
 * as unsigned, never as valid.
 */
function verifyCalSignature(
	rawBody: string,
	signatureHeader: string | null,
	secret: string | undefined,
): boolean {
	if (!signatureHeader || !secret) return false;
	if (signatureHeader === UNSIGNED_MARKER) return false;

	const expected = crypto
		.createHmac("sha256", secret)
		.update(rawBody)
		.digest("hex");

	const provided = Buffer.from(signatureHeader);
	const computed = Buffer.from(expected);

	// timingSafeEqual throws on length mismatch, which also covers garbage input.
	return (
		provided.length === computed.length &&
		crypto.timingSafeEqual(provided, computed)
	);
}

export async function POST(request: Request) {
	const secret = process.env.CAL_WEBHOOK_SECRET;

	if (!secret) {
		// Fail closed: without a secret there is no way to authenticate the
		// caller, and credits hang off this endpoint.
		console.error("CAL_WEBHOOK_SECRET is not set; rejecting Cal.com webhook");
		return NextResponse.json(
			{ error: "Webhook is not configured" },
			{ status: 500 },
		);
	}

	// The signature covers the exact bytes sent, so read the raw text once.
	const rawBody = await request.text();
	const signature = request.headers.get(SIGNATURE_HEADER);

	if (!verifyCalSignature(rawBody, signature, secret)) {
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	let payload: unknown;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	// Log only the trigger and outcome — the payload contains attendee PII.
	const trigger = readCalTrigger(payload);
	const booking = readCalBooking(payload);
	if (!booking) {
		// A verified delivery we cannot attribute is acknowledged, not retried
		// forever: there is no safe action to take on an unreadable payload.
		console.log("Cal.com webhook without a readable booking", { trigger });
		return NextResponse.json({ received: true, handled: false });
	}

	try {
		if ((CREDIT_SPENDING_TRIGGERS as readonly string[]).includes(trigger)) {
			// A reschedule is the same booking; the uid is stable, so the debit is
			// replayed rather than charged again.
			const result = await chargeCalBooking({
				bookingUid: booking.uid,
				eventTypeId: booking.eventTypeId,
				email: booking.email,
				startsAt: booking.startsAt,
			});
			console.log("Cal.com booking charge", {
				trigger,
				status: result.status,
				credits: "credits" in result ? result.credits : 0,
			});
			// Insufficient credits is a business outcome the creator must see, not a
			// transport failure; a 200 stops Cal.com retrying it forever.
			return NextResponse.json({ received: true, status: result.status });
		}

		if ((CREDIT_RESTORING_TRIGGERS as readonly string[]).includes(trigger)) {
			const result = await restoreCalBooking({ bookingUid: booking.uid });
			console.log("Cal.com booking restore", {
				trigger,
				status: result.status,
				credits: "credits" in result ? result.credits : 0,
			});
			return NextResponse.json({ received: true, status: result.status });
		}

		console.log("Received verified Cal.com webhook", { trigger });
		return NextResponse.json({ received: true, handled: false });
	} catch (error) {
		// A real failure (database, allocation) must be retried by Cal.com rather
		// than silently swallowed; the booking uid keeps the retry idempotent.
		console.error("Failed to apply Cal.com booking", {
			trigger,
			type: error instanceof Error ? error.name : "UnknownError",
		});
		return NextResponse.json({ error: "Webhook Error" }, { status: 500 });
	}
}
