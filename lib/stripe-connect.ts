import { getStripe } from "@/lib/stripe";

/**
 * Server-only adapter for Connect account calls: it reads the platform secret
 * via `getStripe()` and must never be imported into a client component.
 *
 * Everything here talks to Stripe's v1 Accounts API with explicit `controller`
 * responsibilities instead of the deprecated `type` shorthand. The agreed
 * configuration is full Dashboard access, Stripe-billed processing fees, and
 * Stripe-managed negative-balance liability — the only combination where a
 * creator can both operate their own Stripe Dashboard and pay their own fees.
 */

export type AgreedControllerConfiguration = {
	dashboardType: "full";
	feesPayer: "account";
	lossesPayments: "stripe";
};

export const AGREED_CONTROLLER: AgreedControllerConfiguration = {
	dashboardType: "full",
	feesPayer: "account",
	lossesPayments: "stripe",
};

/** Failure shape callers can surface without leaking Stripe internals. */
export class StripeAccountError extends Error {
	constructor(
		public code:
			| "STRIPE_UNAVAILABLE"
			| "STRIPE_REJECTED"
			| "ACCOUNT_UNAVAILABLE",
		message: string,
		public readonly status?: number,
	) {
		super(message);
	}
}

function translate(error: unknown): StripeAccountError {
	// Stripe errors can echo request details, so log/return categories only.
	if (error instanceof StripeAccountError) return error;
	if (typeof error === "object" && error !== null) {
		const record = error as { type?: string; statusCode?: number };
		if (record.type === "StripeInvalidRequestError")
			return new StripeAccountError(
				"STRIPE_REJECTED",
				"Stripe rejected this account configuration",
				record.statusCode,
			);
	}
	return new StripeAccountError(
		"STRIPE_UNAVAILABLE",
		"Stripe is temporarily unavailable",
	);
}

function stripe() {
	try {
		return getStripe();
	} catch {
		throw new StripeAccountError(
			"STRIPE_UNAVAILABLE",
			"Stripe is not configured",
		);
	}
}

/** Stable idempotency key for the first account created for a creator. */
export function accountCreationKey(creatorId: string) {
	return `litesubs:connect-account:${creatorId}`;
}

/**
 * Create a creator-owned account with the agreed responsibilities.
 *
 * The caller-supplied idempotency key makes a retried or concurrent onboarding
 * attempt return the same Stripe account instead of creating a second one.
 */
export async function createConnectedAccount(input: {
	creatorId: string;
	email: string;
}) {
	const client = stripe();
	try {
		const account = await client.accounts.create(
			{
				email: input.email,
				controller: {
					stripe_dashboard: { type: AGREED_CONTROLLER.dashboardType },
					fees: { payer: AGREED_CONTROLLER.feesPayer },
					losses: { payments: AGREED_CONTROLLER.lossesPayments },
				},
				capabilities: {
					card_payments: { requested: true },
					transfers: { requested: true },
				},
				metadata: { litesubsUserId: input.creatorId },
			},
			{ idempotencyKey: accountCreationKey(input.creatorId) },
		);
		return account;
	} catch (error) {
		throw translate(error);
	}
}

export async function retrieveConnectedAccount(stripeAccountId: string) {
	const client = stripe();
	try {
		return await client.accounts.retrieve(stripeAccountId);
	} catch (error) {
		throw translate(error);
	}
}

export async function createOnboardingLink(
	stripeAccountId: string,
	urls: { refreshUrl: string; returnUrl: string },
) {
	const client = stripe();
	try {
		return await client.accountLinks.create({
			account: stripeAccountId,
			refresh_url: urls.refreshUrl,
			return_url: urls.returnUrl,
			type: "account_onboarding",
		});
	} catch (error) {
		throw translate(error);
	}
}

/**
 * Open the creator's own Stripe Dashboard.
 *
 * Full-Dashboard accounts authenticate on Stripe, so there is no login link:
 * the honest action is sending them to their Dashboard.
 */
export function dashboardUrl(stripeAccountId: string) {
	return `https://dashboard.stripe.com/${stripeAccountId}`;
}
