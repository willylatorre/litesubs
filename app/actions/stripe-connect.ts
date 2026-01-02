"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import {
	type StripeConnectStatus,
	stripeConnectAccounts,
} from "@/app/db/stripe-connect-schema";
import { STRIPE_CONNECT_ACCOUNT_TYPE } from "@/lib/constants";
import { authenticatedAction } from "@/lib/safe-action";
import { getStripe } from "@/lib/stripe";

/**
 * Get the user's Stripe Connect account status
 * Returns null if no Connect account exists
 */
export async function getConnectAccountStatus() {
	return authenticatedAction(async (session) => {
		const account = await db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.userId, session.user.id),
		});

		if (!account) {
			return { success: true, data: null };
		}

		return {
			success: true,
			data: {
				stripeAccountId: account.stripeAccountId,
				accountType: account.accountType,
				status: account.status,
				chargesEnabled: account.chargesEnabled,
				payoutsEnabled: account.payoutsEnabled,
				detailsSubmitted: account.detailsSubmitted,
				country: account.country,
				defaultCurrency: account.defaultCurrency,
				createdAt: account.createdAt,
				updatedAt: account.updatedAt,
			},
		};
	});
}

/**
 * Create a new Stripe Connect Express account for the user
 * Returns the onboarding URL to redirect the user to
 */
export async function createConnectAccount() {
	return authenticatedAction(async (session) => {
		let stripe;
		try {
			stripe = getStripe();
		} catch {
			return { success: false, error: "Stripe is not configured" };
		}

		const userId = session.user.id;
		const userEmail = session.user.email;

		// Check if user already has a Connect account
		const existingAccount = await db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.userId, userId),
		});

		if (existingAccount) {
			// If account exists but not fully onboarded, create a new account link
			if (!existingAccount.detailsSubmitted) {
				const accountLink = await createAccountLink(
					stripe,
					existingAccount.stripeAccountId,
				);
				return { success: true, data: { url: accountLink.url } };
			}

			return {
				success: false,
				error: "You already have a Stripe Connect account",
			};
		}

		// Create a new Express account
		const account = await stripe.accounts.create({
			type: STRIPE_CONNECT_ACCOUNT_TYPE as "express" | "standard",
			email: userEmail,
			capabilities: {
				card_payments: { requested: true },
				transfers: { requested: true },
			},
			metadata: {
				userId: userId,
				platform: "litesubs",
			},
		});

		// Save the account to database
		await db.insert(stripeConnectAccounts).values({
			userId,
			stripeAccountId: account.id,
			accountType: STRIPE_CONNECT_ACCOUNT_TYPE,
			status: "pending",
			chargesEnabled: account.charges_enabled || false,
			payoutsEnabled: account.payouts_enabled || false,
			detailsSubmitted: account.details_submitted || false,
			country: account.country,
			defaultCurrency: account.default_currency,
		});

		// Create account link for onboarding
		const accountLink = await createAccountLink(stripe, account.id);

		revalidatePath("/dashboard/payouts");

		return {
			success: true,
			data: {
				accountId: account.id,
				url: accountLink.url,
			},
		};
	});
}

/**
 * Create an account link for Connect onboarding or re-authentication
 */
export async function createConnectAccountLink() {
	return authenticatedAction(async (session) => {
		let stripe;
		try {
			stripe = getStripe();
		} catch {
			return { success: false, error: "Stripe is not configured" };
		}

		const account = await db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.userId, session.user.id),
		});

		if (!account) {
			return { success: false, error: "No Connect account found" };
		}

		const accountLink = await createAccountLink(stripe, account.stripeAccountId);

		return { success: true, data: { url: accountLink.url } };
	});
}

/**
 * Get a login link to the Stripe Express Dashboard
 */
export async function getConnectDashboardLink() {
	return authenticatedAction(async (session) => {
		let stripe;
		try {
			stripe = getStripe();
		} catch {
			return { success: false, error: "Stripe is not configured" };
		}

		const account = await db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.userId, session.user.id),
		});

		if (!account) {
			return { success: false, error: "No Connect account found" };
		}

		// Express accounts use login links
		const loginLink = await stripe.accounts.createLoginLink(
			account.stripeAccountId,
		);

		return { success: true, data: { url: loginLink.url } };
	});
}

/**
 * Sync the Connect account status from Stripe
 * Called after onboarding or periodically to update status
 */
export async function syncConnectAccountStatus() {
	return authenticatedAction(async (session) => {
		let stripe;
		try {
			stripe = getStripe();
		} catch {
			return { success: false, error: "Stripe is not configured" };
		}

		const account = await db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.userId, session.user.id),
		});

		if (!account) {
			return { success: false, error: "No Connect account found" };
		}

		// Retrieve the account from Stripe
		const stripeAccount = await stripe.accounts.retrieve(
			account.stripeAccountId,
		);

		// Determine the status
		let status: StripeConnectStatus = "pending";
		if (stripeAccount.details_submitted) {
			if (stripeAccount.charges_enabled && stripeAccount.payouts_enabled) {
				status = "active";
			} else if (
				stripeAccount.requirements?.disabled_reason ||
				stripeAccount.requirements?.currently_due?.length
			) {
				status = "restricted";
			}
		}

		// Update the database
		await db
			.update(stripeConnectAccounts)
			.set({
				status,
				chargesEnabled: stripeAccount.charges_enabled || false,
				payoutsEnabled: stripeAccount.payouts_enabled || false,
				detailsSubmitted: stripeAccount.details_submitted || false,
				country: stripeAccount.country,
				defaultCurrency: stripeAccount.default_currency,
				updatedAt: new Date(),
			})
			.where(eq(stripeConnectAccounts.userId, session.user.id));

		revalidatePath("/dashboard/payouts");

		return {
			success: true,
			data: {
				status,
				chargesEnabled: stripeAccount.charges_enabled,
				payoutsEnabled: stripeAccount.payouts_enabled,
				detailsSubmitted: stripeAccount.details_submitted,
			},
		};
	});
}

/**
 * Disconnect the Stripe Connect account
 * This does NOT delete the Stripe account, just removes the connection
 */
export async function disconnectConnectAccount() {
	return authenticatedAction(async (session) => {
		const account = await db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.userId, session.user.id),
		});

		if (!account) {
			return { success: false, error: "No Connect account found" };
		}

		// Update status to disabled (we don't delete to preserve history)
		await db
			.update(stripeConnectAccounts)
			.set({
				status: "disabled",
				updatedAt: new Date(),
			})
			.where(eq(stripeConnectAccounts.userId, session.user.id));

		revalidatePath("/dashboard/payouts");

		return { success: true };
	});
}

// Helper functions

async function createAccountLink(stripe: ReturnType<typeof getStripe>, accountId: string) {
	const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

	return stripe.accountLinks.create({
		account: accountId,
		refresh_url: `${appUrl}/dashboard/payouts?connect=refresh`,
		return_url: `${appUrl}/dashboard/payouts?connect=complete`,
		type: "account_onboarding",
	});
}

/**
 * Check if a creator has an active Stripe Connect account
 * Used internally when processing payments
 */
export async function getCreatorConnectAccount(creatorId: string) {
	const account = await db.query.stripeConnectAccounts.findFirst({
		where: eq(stripeConnectAccounts.userId, creatorId),
	});

	if (!account || account.status !== "active" || !account.chargesEnabled) {
		return null;
	}

	return account;
}

/**
 * Get stats for Stripe Connect transactions
 * Used to display in the Connect payouts view
 */
export async function getConnectTransactionStats() {
	return authenticatedAction(async (session) => {
		const { transactions } = await import("@/app/db/schema");
		const { and, eq, sql } = await import("drizzle-orm");

		const result = await db
			.select({
				totalTransactions: sql<number>`COUNT(*)`,
				totalVolume: sql<number>`COALESCE(SUM(${transactions.amountMoney}), 0)`,
				totalApplicationFees: sql<number>`COALESCE(SUM(${transactions.stripeApplicationFee}), 0)`,
			})
			.from(transactions)
			.where(
				and(
					eq(transactions.creatorId, session.user.id),
					eq(transactions.usesStripeConnect, true),
					eq(transactions.status, "completed"),
				),
			);

		const stats = result[0] || {
			totalTransactions: 0,
			totalVolume: 0,
			totalApplicationFees: 0,
		};

		return {
			success: true,
			data: {
				totalTransactions: Number(stats.totalTransactions),
				totalVolume: Number(stats.totalVolume),
				totalApplicationFees: Number(stats.totalApplicationFees),
				currency: "usd",
			},
		};
	});
}
