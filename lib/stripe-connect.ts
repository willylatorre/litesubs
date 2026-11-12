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
			| "ACCOUNT_UNAVAILABLE"
			| "OAUTH_UNCONFIGURED"
			| "OAUTH_REJECTED"
			| "OAUTH_DENIED",
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

// Connect OAuth for accounts that already exist

/**
 * Connect OAuth is a different mechanism from account creation: it grants a
 * platform access to an account the creator already operates. It is the only
 * supported way to attach an existing business without creating a second one.
 */
export function oauthClientId() {
	const clientId = process.env.STRIPE_CONNECT_CLIENT_ID?.trim();
	if (!clientId)
		throw new StripeAccountError(
			"OAUTH_UNCONFIGURED",
			"Existing-account connection is not configured",
		);
	return clientId;
}

export function isOauthConfigured() {
	return Boolean(process.env.STRIPE_CONNECT_CLIENT_ID?.trim());
}

/**
 * Build the Stripe-hosted authorization URL.
 *
 * `scope=read_write` is required for platforms; `state` is our single-use CSRF
 * token. `redirect_uri` must exactly match one configured on the platform.
 */
export function authorizeUrl(input: { state: string; redirectUri: string }) {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: oauthClientId(),
		scope: "read_write",
		redirect_uri: input.redirectUri,
		state: input.state,
	});
	return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange a one-time authorization code for the connected account id.
 *
 * The endpoint is deliberately not retried: consuming a code twice revokes the
 * connection, so a retry would break a statement that already succeeded.
 */
export async function exchangeAuthorizationCode(code: string) {
	const client = stripe();
	try {
		return await client.oauth.token({
			grant_type: "authorization_code",
			code,
		});
	} catch (error) {
		throw translateOauth(error);
	}
}

/**
 * Revoke Litesubs' access through Stripe. Only an OAuth-authorized account can
 * be deauthorized; a self-created account is disconnected locally instead.
 */
export async function deauthorizeAccount(stripeAccountId: string) {
	const client = stripe();
	try {
		return await client.oauth.deauthorize({
			client_id: oauthClientId(),
			stripe_user_id: stripeAccountId,
		});
	} catch (error) {
		throw translateOauth(error);
	}
}

function translateOauth(error: unknown): StripeAccountError {
	if (error instanceof StripeAccountError) return error;
	if (typeof error === "object" && error !== null) {
		const { code, type } = error as { code?: string; type?: string };
		// `invalid_grant` means a used/expired code or wrong API-key mode.
		if (code === "invalid_grant" || type === "StripeInvalidRequestError")
			return new StripeAccountError(
				"OAUTH_REJECTED",
				"This authorization is no longer valid. Start the connection again.",
			);
		if (code === "access_denied")
			return new StripeAccountError(
				"OAUTH_DENIED",
				"Stripe authorization was cancelled",
			);
	}
	return new StripeAccountError(
		"STRIPE_UNAVAILABLE",
		"Stripe is temporarily unavailable",
	);
}
