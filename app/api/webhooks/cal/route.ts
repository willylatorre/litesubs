import crypto from "node:crypto";
import { NextResponse } from "next/server";

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

	// TODO: Lookup subscription/product by event type and decrement credits.
	// Log only the trigger type — the payload contains attendee PII.
	const trigger =
		typeof payload === "object" && payload !== null && "triggerEvent" in payload
			? String((payload as { triggerEvent: unknown }).triggerEvent)
			: "unknown";
	console.log("Received verified Cal.com webhook", { trigger });

	return NextResponse.json({ received: true });
}
