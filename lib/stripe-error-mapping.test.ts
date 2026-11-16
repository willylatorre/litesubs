import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createConnectedAccount, translate } from "@/lib/stripe-connect";
import { classifyStripeError } from "@/lib/stripe-error-classify";
import { StripeOfferError } from "@/lib/stripe-offers";

/**
 * Stripe failures have to be split by *who can fix them*.
 *
 * A 403 (`StripePermissionError`), a 401, or "you haven't signed up for
 * Connect" are permanent until an operator changes the platform's Stripe
 * setup. Reporting them as "temporarily unavailable" tells the creator to
 * retry something that can never succeed — which is exactly how a missing
 * restricted-key permission surfaced as an outage.
 *
 * Only genuine transport failures and 5xx belong in the unavailable bucket.
 */

/** The shapes the Stripe SDK actually throws, narrowed to the fields we read. */
const sdkError = (fields: {
	type: string;
	statusCode: number;
	message?: string;
	requestId?: string;
}) => fields;

describe("translate (Connect accounts)", () => {
	// These cases assert the classification, not the logging. The mapping logs a
	// category and request id for operators; silence it so test output stays clean.
	const originalError = console.error;
	before(() => {
		console.error = () => {};
	});
	after(() => {
		console.error = originalError;
	});

	it("treats a permission failure as a setup problem, not an outage", () => {
		const error = translate(
			sdkError({
				type: "StripePermissionError",
				statusCode: 403,
				message:
					"Permission denied. The provided key does not have the required permissions for this endpoint.",
				requestId: "req_123",
			}),
		);
		assert.equal(error.code, "STRIPE_MISCONFIGURED");
		assert.equal(error.status, 403);
		assert.doesNotMatch(error.message, /temporarily unavailable/i);
	});

	it("treats a rejected API key as a setup problem", () => {
		const error = translate(
			sdkError({ type: "StripeAuthenticationError", statusCode: 401 }),
		);
		assert.equal(error.code, "STRIPE_MISCONFIGURED");
	});

	it("treats Connect not being enabled as a setup problem", () => {
		// Stripe reports this as an ordinary invalid request, so the message is
		// the only signal that a retry can never help.
		const error = translate(
			sdkError({
				type: "StripeInvalidRequestError",
				statusCode: 400,
				message:
					"You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.",
			}),
		);
		assert.equal(error.code, "STRIPE_MISCONFIGURED");
	});

	it("still reports a genuinely invalid account configuration as rejected", () => {
		const error = translate(
			sdkError({
				type: "StripeInvalidRequestError",
				statusCode: 400,
				message: "Invalid controller configuration",
			}),
		);
		assert.equal(error.code, "STRIPE_REJECTED");
	});

	it("keeps real transport failures in the retryable bucket", () => {
		const error = translate(
			sdkError({ type: "StripeConnectionError", statusCode: 500 }),
		);
		assert.equal(error.code, "STRIPE_UNAVAILABLE");
	});

	it("passes an already-translated error through unchanged", () => {
		const original = translate(
			sdkError({ type: "StripeConnectionError", statusCode: 500 }),
		);
		assert.equal(translate(original), original);
	});

	it("does not leak Stripe's message, only our own wording", () => {
		const error = translate(
			sdkError({
				type: "StripePermissionError",
				statusCode: 403,
				message: "The provided key 'rk_live_secret' does not have permission",
			}),
		);
		assert.doesNotMatch(error.message, /rk_live_/);
	});

	it("treats a missing API key as a setup problem, not an outage", async () => {
		// getStripe() throws a plain Error when the env var is absent. That is a
		// deployment mistake; calling it "unavailable" implies a retry will help.
		const original = process.env.STRIPE_SECRET_KEY;
		delete process.env.STRIPE_SECRET_KEY;
		try {
			await assert.rejects(
				() => createConnectedAccount({ creatorId: "u1", email: "a@b.test" }),
				(error: { code?: string }) => {
					assert.equal(error.code, "STRIPE_MISCONFIGURED");
					return true;
				},
			);
		} finally {
			if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
		}
	});
});

describe("classifyStripeError", () => {
	/**
	 * Both Stripe adapters share this rule, so the classification itself is
	 * pinned here rather than only through one translator.
	 */
	it("treats a 403 permission failure as misconfigured", () => {
		assert.equal(
			classifyStripeError({ type: "StripePermissionError", statusCode: 403 }),
			"misconfigured",
		);
	});

	it("treats a rejected key as misconfigured", () => {
		assert.equal(
			classifyStripeError({
				type: "StripeAuthenticationError",
				statusCode: 401,
			}),
			"misconfigured",
		);
	});

	it("recognises Connect not being enabled from the message", () => {
		assert.equal(
			classifyStripeError({
				type: "StripeInvalidRequestError",
				message:
					"You can only create new accounts if you've signed up for Connect.",
			}),
			"misconfigured",
		);
	});

	it("keeps an ordinary invalid request separate", () => {
		assert.equal(
			classifyStripeError({
				type: "StripeInvalidRequestError",
				message: "Invalid controller configuration",
			}),
			"invalid_request",
		);
	});

	it("treats transport and unknown failures as retryable", () => {
		for (const type of [
			"StripeConnectionError",
			"StripeAPIError",
			"StripeRateLimitError",
			undefined,
		])
			assert.equal(classifyStripeError({ type }), "retryable");
		assert.equal(classifyStripeError("not an error"), "retryable");
		assert.equal(classifyStripeError(null), "retryable");
	});
});

describe("StripeOfferError codes", () => {
	/**
	 * Publishing plans uses a parallel error type, so the same distinction has
	 * to hold there: a setup problem must not read as a transient outage.
	 */
	it("keeps setup failures distinct from outages", () => {
		const misconfigured = new StripeOfferError(
			"STRIPE_MISCONFIGURED",
			"Stripe is not set up correctly for this app. Contact support.",
		);
		const unavailable = new StripeOfferError(
			"STRIPE_UNAVAILABLE",
			"Stripe is temporarily unavailable",
		);
		assert.notEqual(misconfigured.code, unavailable.code);
	});
});
