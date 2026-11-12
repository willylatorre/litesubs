import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/app/db";
import {
	type AccountOnboardingMode,
	type ConnectedAccount,
	connectedAccounts,
} from "@/app/db/stripe-connect-schema";
import { appUrl } from "@/lib/app-url";
import { deriveReadiness } from "@/lib/connect-readiness";
import {
	AGREED_CONTROLLER,
	createConnectedAccount,
	createOnboardingLink,
	dashboardUrl,
	retrieveConnectedAccount,
	StripeAccountError,
} from "@/lib/stripe-connect";
import { ServiceError } from "./principal";

/**
 * A creator's payment readiness, shaped for both the setup screen and the
 * checkout gate. `canSell` is the only field new sales may branch on.
 */
export type PaymentReadiness = {
	hasAccount: boolean;
	status: ConnectedAccount["status"] | "not_connected";
	canSell: boolean;
	/** The account a sale is charged on. Only set when an account exists. */
	stripeAccountId: string | null;
	dashboardUrl: string | null;
	needsAttention: boolean;
	detailsSubmitted: boolean;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	requirementsDue: string[];
	disabledReason: string | null;
	country: string | null;
	defaultCurrency: string | null;
	/** Wording shown to creators; never claims Litesubs has no obligations. */
	responsibilities: {
		dashboard: string;
		fees: string;
		losses: string;
	};
	lastSyncedAt: Date | null;
};

const RESPONSIBILITY_COPY = {
	dashboard:
		"You get the full Stripe Dashboard for your business, customers, and payments.",
	fees: "Stripe bills you for payment processing fees on your own account.",
	losses:
		"Stripe manages negative balance liability for your account under the agreed configuration. Litesubs still has its own legal and platform obligations.",
} as const;

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
		requirements: {
			currently_due: account.requirementsCurrentlyDue,
			disabled_reason: account.requirementsDisabledReason,
		},
	});
	return {
		hasAccount: true,
		status: account.status,
		canSell,
		stripeAccountId: account.stripeAccountId,
		dashboardUrl: dashboardUrl(account.stripeAccountId),
		needsAttention,
		detailsSubmitted: account.detailsSubmitted,
		chargesEnabled: account.chargesEnabled,
		payoutsEnabled: account.payoutsEnabled,
		requirementsDue: account.requirementsCurrentlyDue,
		disabledReason: account.requirementsDisabledReason,
		country: account.country,
		defaultCurrency: account.defaultCurrency,
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
export async function syncConnectedAccount(creatorId: string) {
	const existing = await findOwnAccount(creatorId);
	if (!existing)
		throw new ServiceError("NOT_CONNECTED", "No Stripe account connected", 404);

	let account: Awaited<ReturnType<typeof retrieveConnectedAccount>>;
	try {
		account = await retrieveConnectedAccount(existing.stripeAccountId);
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

/**
 * Stop sales without deleting the Stripe account or any payment history.
 *
 * Account-owned records keep their original account identity; this only removes
 * the creator's ability to start new sales until they reconnect.
 */
export async function disconnectAccount(creatorId: string) {
	const existing = await findOwnAccount(creatorId);
	if (!existing)
		throw new ServiceError("NOT_CONNECTED", "No Stripe account connected", 404);
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

/** Exposed for copy/tests: the responsibilities requested at creation. */
export const requestedResponsibilities = AGREED_CONTROLLER;
