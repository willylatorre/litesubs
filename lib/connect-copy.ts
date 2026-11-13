/**
 * Creator-facing wording for connected-account responsibilities.
 *
 * Kept in its own module with no imports so client components can render it
 * without pulling the database or Stripe SDK into the browser bundle.
 */

export type CompatibilityIssue =
	| "platform_controlled"
	| "no_full_dashboard"
	| "platform_pays_fees"
	| "platform_liable_for_losses"
	| "unknown_configuration";

export type ResponsibilityCopy = {
	dashboard: string;
	fees: string;
	losses: string;
};

export const RESPONSIBILITY_COPY: ResponsibilityCopy = {
	dashboard:
		"You get the full Stripe Dashboard for your business, customers, and payments.",
	fees: "Stripe bills you for payment processing fees on your own account.",
	losses:
		"Stripe manages negative balance liability for your account under the agreed configuration. Litesubs still has its own legal and platform obligations.",
};

/** Explanation for each incompatibility; the account is never silently changed. */
export const COMPATIBILITY_MESSAGES: Record<CompatibilityIssue, string> = {
	platform_controlled:
		"This is a Stripe account Litesubs manages for you, not a business you operate. Connect the account you log in to yourself.",
	no_full_dashboard:
		"This account does not have full Dashboard access, so you would lose control of your own business. Use an account with the full Stripe Dashboard.",
	platform_pays_fees:
		"On this account Litesubs would pay Stripe's processing fees instead of you. That is not the agreed setup for creator-owned payments.",
	platform_liable_for_losses:
		"Litesubs would be responsible for this account's negative balances. Connect an account where Stripe carries that responsibility.",
	unknown_configuration:
		"Stripe did not report a responsibility configuration Litesubs recognises. Contact support instead of changing it silently.",
};

/** Account status as the UI shows it; no database types required. */
export type PaymentReadiness = {
	hasAccount: boolean;
	status: "not_connected" | "pending" | "active" | "restricted" | "disabled";
	canSell: boolean;
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
	authorizedViaOauth: boolean;
	compatible: boolean;
	compatibilityIssues: CompatibilityIssue[];
	existingAccountAvailable: boolean;
	responsibilities: ResponsibilityCopy;
	/** Serialized as a Date over the RSC boundary. */
	lastSyncedAt: Date | string | null;
	/**
	 * How many subscriptions on this account can still renew. A disconnect has to
	 * handle them explicitly; 0 means detaching stops no one's access.
	 */
	liveSubscriptions: number;
	/** Why the last disconnect did not finish; null when nothing failed. */
	disconnectFailure: string | null;
};
