/**
 * Classify a Stripe SDK error by *who can fix it*.
 *
 * The distinction matters because the two failure modes read almost identically
 * in logs but mean opposite things to a creator:
 *
 * - `misconfigured` — the platform's own credentials are wrong: a rejected key,
 *   a restricted key missing a permission, or Connect never enabled on the
 *   platform account. No retry can fix it; an operator must.
 * - `invalid_request` — Stripe refused the specific parameters we sent.
 * - `retryable` — transport failure, rate limit, or Stripe 5xx. Retrying helps.
 *
 * Both the Connect and plan-offer adapters translate Stripe failures, so the
 * rule lives here rather than being restated in each of them.
 */

export type StripeFailureKind =
	| "misconfigured"
	| "invalid_request"
	| "retryable";

/** Stripe's wording when the platform account has not enabled Connect. */
const CONNECT_NOT_ENABLED = /signed up for Connect/i;

export function classifyStripeError(error: unknown): StripeFailureKind {
	if (typeof error !== "object" || error === null) return "retryable";
	const { type, message } = error as { type?: string; message?: string };

	// 401/403 on the platform's own credentials.
	if (type === "StripePermissionError" || type === "StripeAuthenticationError")
		return "misconfigured";

	// Connect not being enabled arrives as an ordinary invalid request, so the
	// message is the only signal that a retry can never help.
	if (type === "StripeInvalidRequestError")
		return CONNECT_NOT_ENABLED.test(message ?? "")
			? "misconfigured"
			: "invalid_request";

	return "retryable";
}

/**
 * Log a Stripe failure for operators.
 *
 * Only the category and Stripe's request id: Stripe error messages can echo
 * request details, including key fragments.
 */
export function logStripeFailure(error: unknown) {
	if (typeof error !== "object" || error === null) return;
	const { type, requestId } = error as { type?: string; requestId?: string };
	if (!type) return;
	console.error("Stripe request failed", { type, requestId });
}
