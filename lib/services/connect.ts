import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/app/db";
import { enrollments } from "@/app/db/schema";
import {
	type AccountOnboardingMode,
	type ConnectedAccount,
	connectedAccounts,
	connectOauthStates,
} from "@/app/db/stripe-connect-schema";
import { appUrl } from "@/lib/app-url";
import {
	type CompatibilityIssue,
	type PaymentReadiness,
	RESPONSIBILITY_COPY,
} from "@/lib/connect-copy";
import { deriveReadiness } from "@/lib/connect-readiness";
import {
	AGREED_CONTROLLER,
	authorizeUrl,
	createConnectedAccount,
	createOnboardingLink,
	dashboardUrl,
	deauthorizeAccount,
	exchangeAuthorizationCode,
	isOauthConfigured,
	retrieveConnectedAccount,
	StripeAccountError,
} from "@/lib/stripe-connect";
import { ServiceError } from "./principal";

/**
 * The Stripe calls this service depends on. Production uses the real adapter;
 * tests at the service boundary substitute these instead of depending on
 * Stripe's HTTP behaviour. Nothing here is exposed to application callers.
 */
export type ConnectStripeAdapter = {
	exchangeAuthorizationCode: typeof exchangeAuthorizationCode;
	retrieveConnectedAccount: typeof retrieveConnectedAccount;
};

const defaultAdapter: ConnectStripeAdapter = {
	exchangeAuthorizationCode,
	retrieveConnectedAccount,
};

/** The UI-facing shape lives in an import-free module for client reuse. */
export type { PaymentReadiness } from "@/lib/connect-copy";

/**
 * Whether a connected account's *configuration* is compatible with what
 * Litesubs depends on: a self-controlled account that keeps its own Dashboard,
 * pays Stripe's fees, and carries Stripe negative-balance liability.
 *
 * This is a check, not a change. Controller configuration cannot be edited
 * after creation (Stripe rejects changing `stripe_dashboard.type`), so an
 * incompatible account must be explained and refused rather than silently
 * reconfigured or quietly charged as a destination charge.
 */
export type Compatibility = {
	compatible: boolean;
	issues: CompatibilityIssue[];
	configuration: {
		controllerType: string | null;
		dashboardType: string | null;
		feesPayer: string | null;
		lossesPayments: string | null;
	};
};

type ControllerLike = {
	controller?: {
		type?: string;
		stripe_dashboard?: { type?: string } | null;
		fees?: { payer?: string } | null;
		losses?: { payments?: string } | null;
	} | null;
};

export function checkCompatibility(account: ControllerLike): Compatibility {
	const controller = account.controller;
	const configuration = {
		controllerType: controller?.type ?? null,
		dashboardType: controller?.stripe_dashboard?.type ?? null,
		feesPayer: controller?.fees?.payer ?? null,
		lossesPayments: controller?.losses?.payments ?? null,
	};
	const issues: CompatibilityIssue[] = [];

	// An account Litesubs created is platform-controlled; an OAuth-connected
	// business controls itself. Only the latter matches the agreed model.
	if (configuration.controllerType === "application")
		issues.push("platform_controlled");
	else if (configuration.controllerType !== "account")
		issues.push("unknown_configuration");

	if (configuration.dashboardType !== "full") issues.push("no_full_dashboard");
	// `application` here means the platform absorbs Stripe's fees, which is the
	// opposite of the agreement and changes who pays for processing.
	if (configuration.feesPayer === "application")
		issues.push("platform_pays_fees");
	else if (configuration.feesPayer !== "account")
		issues.push("unknown_configuration");

	if (configuration.lossesPayments === "application")
		issues.push("platform_liable_for_losses");
	else if (configuration.lossesPayments !== "stripe")
		issues.push("unknown_configuration");

	return {
		compatible: issues.length === 0,
		issues: [...new Set(issues)],
		configuration,
	};
}

async function findOwnAccount(creatorId: string) {
	return db.query.connectedAccounts.findFirst({
		where: and(
			eq(connectedAccounts.userId, creatorId),
			isNull(connectedAccounts.disconnectedAt),
		),
	});
}

function toReadiness(account: ConnectedAccount | undefined): PaymentReadiness {
	if (!account) {
		return {
			hasAccount: false,
			status: "not_connected",
			canSell: false,
			stripeAccountId: null,
			dashboardUrl: null,
			needsAttention: true,
			detailsSubmitted: false,
			chargesEnabled: false,
			payoutsEnabled: false,
			requirementsDue: [],
			disabledReason: null,
			country: null,
			defaultCurrency: null,
			authorizedViaOauth: false,
			compatible: true,
			compatibilityIssues: [],
			existingAccountAvailable: isOauthConfigured(),
			responsibilities: RESPONSIBILITY_COPY,
			lastSyncedAt: null,
		};
	}
	// Never trust `status` alone: derive from the synced capability snapshot so
	// a stale row cannot enable sales.
	const { canSell, needsAttention } = deriveReadiness({
		charges_enabled: account.chargesEnabled,
		payouts_enabled: account.payoutsEnabled,
		details_submitted: account.detailsSubmitted,
		capabilities: { card_payments: account.cardPaymentsStatus },
		requirements: {
			currently_due: account.requirementsCurrentlyDue,
			disabled_reason: account.requirementsDisabledReason,
		},
	});
	// Stored configuration is re-checked on read, so an account whose
	// responsibilities differ is never reported as agreed.
	const compatibility = checkCompatibility({
		controller: {
			type: account.controllerType ?? undefined,
			stripe_dashboard: { type: account.dashboardType ?? undefined },
			fees: { payer: account.feesPayer ?? undefined },
			losses: { payments: account.lossesPayments ?? undefined },
		},
	});
	return {
		hasAccount: true,
		// An incompatible account never shows as sellable, even if Stripe would
		// accept a charge on it: the agreed responsibilities are what we sell on.
		status: compatibility.compatible ? account.status : "restricted",
		canSell: canSell && compatibility.compatible,
		stripeAccountId: account.stripeAccountId,
		dashboardUrl: dashboardUrl(account.stripeAccountId),
		needsAttention: needsAttention || !compatibility.compatible,
		detailsSubmitted: account.detailsSubmitted,
		chargesEnabled: account.chargesEnabled,
		payoutsEnabled: account.payoutsEnabled,
		requirementsDue: account.requirementsCurrentlyDue,
		disabledReason: account.requirementsDisabledReason,
		country: account.country,
		defaultCurrency: account.defaultCurrency,
		authorizedViaOauth: account.authorizedViaOauth,
		compatible: compatibility.compatible,
		compatibilityIssues: compatibility.issues,
		existingAccountAvailable: isOauthConfigured(),
		responsibilities: RESPONSIBILITY_COPY,
		lastSyncedAt: account.lastSyncedAt,
	};
}

/** Read the creator's readiness without calling Stripe. */
export async function getPaymentReadiness(
	creatorId: string,
): Promise<PaymentReadiness> {
	return toReadiness(await findOwnAccount(creatorId));
}

/** Boolean gate used by checkout: only a payment-ready account may sell. */
export async function canAcceptPayments(creatorId: string) {
	return (await getPaymentReadiness(creatorId)).canSell;
}

async function persistAccountSnapshot(
	account: Awaited<ReturnType<typeof createConnectedAccount>>,
	mode: AccountOnboardingMode,
) {
	const readiness = deriveReadiness(account);
	const controller = account.controller;
	await db
		.insert(connectedAccounts)
		.values({
			userId: (account.metadata?.litesubsUserId as string) || "",
			stripeAccountId: account.id,
			onboardingMode: mode,
			status: readiness.status,
			controllerType: controller?.type ?? null,
			dashboardType: controller?.stripe_dashboard?.type ?? null,
			feesPayer: controller?.fees?.payer ?? null,
			lossesPayments: controller?.losses?.payments ?? null,
			chargesEnabled: readiness.chargesEnabled,
			payoutsEnabled: readiness.payoutsEnabled,
			cardPaymentsStatus: account.capabilities?.card_payments ?? null,
			detailsSubmitted: readiness.detailsSubmitted,
			country: account.country ?? null,
			defaultCurrency: account.default_currency ?? null,
			requirementsCurrentlyDue: readiness.requirementsDue,
			requirementsDisabledReason: readiness.disabledReason,
			lastSyncedAt: new Date(),
		})
		.onConflictDoNothing({ target: connectedAccounts.userId });
}

/**
 * Start (or restart) new-account onboarding and return the Stripe-hosted URL.
 *
 * Safe to call repeatedly: an existing local account is reused, and Stripe's
 * idempotency key means a lost response cannot create a second account.
 */
export async function startNewAccountOnboarding(input: {
	creatorId: string;
	email: string;
}): Promise<{ url: string; accountId: string }> {
	const existing = await findOwnAccount(input.creatorId);
	let accountId = existing?.stripeAccountId;

	if (!accountId) {
		let created: Awaited<ReturnType<typeof createConnectedAccount>>;
		try {
			created = await createConnectedAccount(input);
		} catch (error) {
			if (error instanceof StripeAccountError)
				throw new ServiceError(error.code, error.message, 502);
			throw error;
		}
		await persistAccountSnapshot(created, "created");
		accountId = created.id;
	}

	try {
		const link = await createOnboardingLink(accountId, {
			refreshUrl: appUrl("/dashboard/payments?onboarding=refresh"),
			returnUrl: appUrl("/dashboard/payments?onboarding=complete"),
		});
		if (!link.url)
			throw new ServiceError(
				"ONBOARDING_UNAVAILABLE",
				"Stripe did not return an onboarding link",
				502,
			);
		return { url: link.url, accountId };
	} catch (error) {
		if (error instanceof ServiceError) throw error;
		if (error instanceof StripeAccountError)
			throw new ServiceError(error.code, error.message, 502);
		throw error;
	}
}

/**
 * Re-read the account from Stripe and persist what it reports. Called after
 * onboarding returns, after a refresh, and from the webhook; the stored row is
 * a cache of Stripe's authority, not the source of truth.
 */
export async function syncConnectedAccount(
	creatorId: string,
	adapter: ConnectStripeAdapter = defaultAdapter,
) {
	const existing = await findOwnAccount(creatorId);
	if (!existing)
		throw new ServiceError("NOT_CONNECTED", "No Stripe account connected", 404);

	let account: Awaited<ReturnType<typeof retrieveConnectedAccount>>;
	try {
		account = await adapter.retrieveConnectedAccount(existing.stripeAccountId);
	} catch (error) {
		if (error instanceof StripeAccountError)
			throw new ServiceError(error.code, error.message, 502);
		throw error;
	}

	const readiness = deriveReadiness(account);
	const controller = account.controller;
	const [updated] = await db
		.update(connectedAccounts)
		.set({
			status: readiness.status,
			controllerType: controller?.type ?? existing.controllerType,
			dashboardType:
				controller?.stripe_dashboard?.type ?? existing.dashboardType,
			feesPayer: controller?.fees?.payer ?? existing.feesPayer,
			lossesPayments: controller?.losses?.payments ?? existing.lossesPayments,
			chargesEnabled: readiness.chargesEnabled,
			payoutsEnabled: readiness.payoutsEnabled,
			cardPaymentsStatus: account.capabilities?.card_payments ?? null,
			detailsSubmitted: readiness.detailsSubmitted,
			country: account.country ?? existing.country,
			defaultCurrency: account.default_currency ?? existing.defaultCurrency,
			requirementsCurrentlyDue: readiness.requirementsDue,
			requirementsDisabledReason: readiness.disabledReason,
			lastSyncedAt: new Date(),
		})
		.where(
			and(
				eq(connectedAccounts.id, existing.id),
				eq(connectedAccounts.userId, creatorId),
			),
		)
		.returning();
	return toReadiness(updated);
}

/** Exposed for copy/tests: the responsibilities requested at creation. */
export const requestedResponsibilities = AGREED_CONTROLLER;

export type { CompatibilityIssue } from "@/lib/connect-copy";

// Connect OAuth: attaching an existing account

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * State is stored hashed and consumed atomically. Hashing means a leaked
 * database dump cannot be turned back into a working callback URL.
 */
function hashState(state: string) {
	return createHash("sha256").update(state).digest("hex");
}

export function oauthCallbackUrl() {
	return appUrl("/api/connect/oauth/callback");
}

/**
 * Begin connecting an existing Stripe account and return the Stripe URL.
 *
 * Only a creator without a live account may start this; switching an account
 * that already sells is explicitly unsupported (see `switchNotSupported`).
 */
export async function startExistingAccountConnection(creatorId: string) {
	if (!isOauthConfigured())
		throw new ServiceError(
			"OAUTH_UNCONFIGURED",
			"Connecting an existing Stripe account is not available yet",
			503,
		);

	const existing = await findOwnAccount(creatorId);
	if (existing) {
		const otherRecords = await db.query.enrollments.findFirst({
			where: eq(enrollments.creatorId, creatorId),
		});
		// Being lenient here would silently point new charges at a different
		// account while historical payments stay on the old one.
		if (otherRecords)
			throw new ServiceError(
				"ACCOUNT_SWITCH_UNSUPPORTED",
				"This creator already has customers on a Stripe account. Switching accounts needs separate handling.",
				409,
			);
	}

	const state = crypto.randomUUID() + crypto.randomUUID();
	await db.insert(connectOauthStates).values({
		stateHash: hashState(state),
		userId: creatorId,
		expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
	});

	return {
		url: authorizeUrl({ state, redirectUri: oauthCallbackUrl() }),
	};
}

/**
 * Finish an OAuth connection.
 *
 * Order matters: the state must belong to the signed-in creator, be unexpired,
 * and be unconsumed. Consumption is a conditional update so two concurrent
 * callbacks cannot both succeed.
 */
export async function completeExistingAccountConnection(
	input: {
		creatorId: string;
		state: string;
		code: string;
	},
	adapter: ConnectStripeAdapter = defaultAdapter,
) {
	const invalid = () =>
		new ServiceError(
			"OAUTH_STATE_INVALID",
			"This connection request is no longer valid. Start again.",
			400,
		);

	const consumed = await db
		.update(connectOauthStates)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(connectOauthStates.stateHash, hashState(input.state)),
				eq(connectOauthStates.userId, input.creatorId),
				isNull(connectOauthStates.consumedAt),
				gt(connectOauthStates.expiresAt, new Date()),
			),
		)
		.returning({ id: connectOauthStates.id });
	if (!consumed.length) throw invalid();

	let token: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
	try {
		token = await adapter.exchangeAuthorizationCode(input.code);
	} catch (error) {
		if (error instanceof StripeAccountError)
			throw new ServiceError(error.code, error.message, 400);
		throw error;
	}
	const stripeAccountId = token.stripe_user_id;
	if (!stripeAccountId)
		throw new ServiceError(
			"OAUTH_REJECTED",
			"Stripe did not return an account for this authorization",
			400,
		);

	let account: Awaited<ReturnType<typeof retrieveConnectedAccount>>;
	try {
		account = await adapter.retrieveConnectedAccount(stripeAccountId);
	} catch (error) {
		if (error instanceof StripeAccountError)
			throw new ServiceError(error.code, error.message, 502);
		throw error;
	}

	// The account is real, but its responsibilities may not be ours to depend on.
	const compatibility = checkCompatibility(account);
	const readiness = deriveReadiness(account);

	await db.transaction(async (tx) => {
		// Reconnecting the same account restores the mapping; it never creates a
		// second row, and a different account with live records is refused above.
		const prior = await tx.query.connectedAccounts.findFirst({
			where: eq(connectedAccounts.userId, input.creatorId),
		});
		if (prior && prior.stripeAccountId !== stripeAccountId) {
			const hasHistory = await tx.query.enrollments.findFirst({
				where: eq(enrollments.creatorId, input.creatorId),
			});
			if (hasHistory)
				throw new ServiceError(
					"ACCOUNT_SWITCH_UNSUPPORTED",
					"This creator already has customers on another Stripe account. Switching accounts needs separate handling.",
					409,
				);
		}

		const values = {
			stripeAccountId,
			onboardingMode: "connected" as const,
			authorizedViaOauth: true,
			livemode: token.livemode ?? null,
			status: compatibility.compatible ? readiness.status : "restricted",
			controllerType: compatibility.configuration.controllerType,
			dashboardType: compatibility.configuration.dashboardType,
			feesPayer: compatibility.configuration.feesPayer,
			lossesPayments: compatibility.configuration.lossesPayments,
			chargesEnabled: readiness.chargesEnabled,
			payoutsEnabled: readiness.payoutsEnabled,
			cardPaymentsStatus: account.capabilities?.card_payments ?? null,
			detailsSubmitted: readiness.detailsSubmitted,
			country: account.country ?? null,
			defaultCurrency: account.default_currency ?? null,
			requirementsCurrentlyDue: readiness.requirementsDue,
			requirementsDisabledReason: readiness.disabledReason,
			lastSyncedAt: new Date(),
			disconnectedAt: null,
		};

		await tx
			.insert(connectedAccounts)
			.values({ userId: input.creatorId, ...values })
			.onConflictDoUpdate({
				target: connectedAccounts.userId,
				set: values,
			});
	});

	return {
		accountId: stripeAccountId,
		compatible: compatibility.compatible,
		issues: compatibility.issues,
	};
}

/**
 * Disconnect. An OAuth-authorized account is deauthorized at Stripe so the
 * platform genuinely loses access; a self-created account is only detached
 * locally. Either way new sales stop and historical records keep their account.
 */
export async function disconnectAccount(creatorId: string) {
	const existing = await findOwnAccount(creatorId);
	if (!existing)
		throw new ServiceError("NOT_CONNECTED", "No Stripe account connected", 404);

	if (existing.authorizedViaOauth && isOauthConfigured()) {
		try {
			await deauthorizeAccount(existing.stripeAccountId);
		} catch (error) {
			// Report a real failure instead of pretending the local flag is enough.
			if (error instanceof StripeAccountError)
				throw new ServiceError("DEAUTHORIZE_FAILED", error.message, 502);
			throw error;
		}
	}

	await db
		.update(connectedAccounts)
		.set({ disconnectedAt: new Date(), status: "disabled" })
		.where(
			and(
				eq(connectedAccounts.id, existing.id),
				eq(connectedAccounts.userId, creatorId),
			),
		);
	return { success: true as const };
}

/** Called by the deauthorization webhook; never revives a disconnected row. */
export async function markAccountDeauthorized(stripeAccountId: string) {
	const existing = await db.query.connectedAccounts.findFirst({
		where: eq(connectedAccounts.stripeAccountId, stripeAccountId),
	});
	if (!existing) return { handled: false as const };
	await db
		.update(connectedAccounts)
		.set({
			status: "disabled",
			disconnectedAt: existing.disconnectedAt ?? new Date(),
			chargesEnabled: false,
			lastSyncedAt: new Date(),
		})
		.where(eq(connectedAccounts.id, existing.id));
	return { handled: true as const };
}
