"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MIN_PAYOUT_AMOUNT, PLATFORM_FEE_PERCENT } from "@/lib/constants";
import { stripe } from "@/lib/stripe";
import { z } from "zod";
import { db } from "@/app/db";
import { earningsLedger, payouts, creatorPayoutAccounts } from "@/app/db/payouts-schema";
import { authenticatedAction } from "@/lib/safe-action";

// Schemas
const requestPayoutSchema = z.object({
	amount: z.number().positive().min(MIN_PAYOUT_AMOUNT),
});

// Helpers

async function calculateUserBalance(tx: any, userId: string) {
	// Calculate totals from ledger
	const ledgerEntries = await tx
		.select({
			amount: earningsLedger.amount,
			type: earningsLedger.transactionType,
		})
		.from(earningsLedger)
		.where(eq(earningsLedger.userId, userId));

	let totalEarnings = 0;
	let totalPaidOut = 0;
	let totalAdjustments = 0;

	for (const entry of ledgerEntries) {
		const amount = parseFloat(entry.amount);
		if (entry.type === "sale") {
			totalEarnings += amount;
		} else if (entry.type === "payout") {
			totalPaidOut += Math.abs(amount);
		} else {
			totalAdjustments += amount;
		}
	}

	// Calculate pending payouts separately from payout table to be accurate
	// Only count 'pending' status because 'processing' and 'completed' are already in the ledger
	const pendingPayoutRecs = await tx
		.select({ amount: payouts.amount })
		.from(payouts)
		.where(and(eq(payouts.userId, userId), eq(payouts.status, "pending")));

	let pendingPayouts = 0;
	for (const p of pendingPayoutRecs) {
		pendingPayouts += parseFloat(p.amount);
	}

	const platformFees = totalEarnings * PLATFORM_FEE_PERCENT;
	const availableBalance =
		totalEarnings - platformFees - totalPaidOut + totalAdjustments - pendingPayouts;

	return {
		totalEarnings,
		platformFees,
		totalPaidOut,
		pendingPayouts,
		availableBalance,
	};
}

// Actions

export async function getAccountBalance() {
	return authenticatedAction(async (session) => {
		const userId = session.user.id;
		const balance = await calculateUserBalance(db, userId);

		return {
			success: true,
			data: {
				...balance,
				availableBalance: Math.max(0, balance.availableBalance), // No negative balance display
				canRequestPayout: balance.availableBalance >= MIN_PAYOUT_AMOUNT,
				minimumPayout: MIN_PAYOUT_AMOUNT,
			},
		};
	});
}

export async function getPayoutAccount() {
	return authenticatedAction(async (session) => {
		const account = await db.query.creatorPayoutAccounts.findFirst({
			where: eq(creatorPayoutAccounts.userId, session.user.id),
		});
		return { success: true, data: account };
	});
}

export async function getPayoutHistory() {
	return authenticatedAction(async (session) => {
		const history = await db.query.payouts.findMany({
			where: eq(payouts.userId, session.user.id),
			orderBy: [desc(payouts.createdAt)],
		});
		return { success: true, data: history };
	});
}

export async function setupPayoutAccount() {
	return authenticatedAction(async (session) => {
		const userId = session.user.id;
		const userEmail = session.user.email;

		// 1. Check if local record exists
		let account = await db.query.creatorPayoutAccounts.findFirst({
			where: eq(creatorPayoutAccounts.userId, userId),
		});

		let stripeRecipientId = account?.stripeRecipientId;

		// 2. If no Stripe Account ID, create one (Global Payouts Recipient via v2 API)
		if (!stripeRecipientId) {
			const stripeAccount = await stripe.v2.core.accounts.create({
				contact_email: userEmail,
				configuration: {
					recipient: {
						capabilities: {
							bank_accounts: {
								local: {
									requested: true,
								},
							},
						},
					},
				},
				identity: {
					country: "US", // Default to US or infer from user
					entity_type: "individual",
				},
				include: ["requirements", "configuration.recipient", "identity"],
				metadata: {
					userId: userId,
				},
			});
			stripeRecipientId = stripeAccount.id;

			// Save/Update DB
			if (account) {
				await db
					.update(creatorPayoutAccounts)
					.set({ stripeRecipientId })
					.where(eq(creatorPayoutAccounts.userId, userId));
			} else {
				await db.insert(creatorPayoutAccounts).values({
					userId,
					stripeRecipientId,
					verificationStatus: "pending",
				});
			}
		}

		// 3. Create Account Link for onboarding
		const accountLink = await stripe.accountLinks.create({
			account: stripeRecipientId,
			refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/payouts?setup=refresh`,
			return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/payouts?setup=complete`,
			type: "account_onboarding",
		});

		return { success: true, data: { url: accountLink.url } };
	});
}

export async function syncPayoutAccountStatus() {
	return authenticatedAction(async (session) => {
		const account = await db.query.creatorPayoutAccounts.findFirst({
			where: eq(creatorPayoutAccounts.userId, session.user.id),
		});

		if (!account?.stripeRecipientId) return { success: false, error: "No account" };

		const stripeAccount = await stripe.accounts.retrieve(account.stripeRecipientId);

		const isEnabled = stripeAccount.payouts_enabled && stripeAccount.charges_enabled;
		// Note: details_submitted is strictly for onboarding completion
		const status = stripeAccount.details_submitted ? (isEnabled ? 'verified' : 'pending') : 'pending';

		await db
			.update(creatorPayoutAccounts)
			.set({ verificationStatus: status })
			.where(eq(creatorPayoutAccounts.userId, session.user.id));

		revalidatePath("/dashboard/payouts");
		return { success: true, data: { status } };
	});
}


export async function requestPayout(input: z.infer<typeof requestPayoutSchema>) {
	return authenticatedAction(async (session, input: z.infer<typeof requestPayoutSchema>) => {
		const userId = session.user.id;
		const { amount } = input;

		// 1. Re-validate Balance inside a transaction
		const result = await db.transaction(async (tx) => {
			const { availableBalance } = await calculateUserBalance(tx, userId);

			if (amount > availableBalance) {
				throw new Error("Insufficient funds");
			}

			if (amount < MIN_PAYOUT_AMOUNT) {
				throw new Error(`Minimum payout is $${MIN_PAYOUT_AMOUNT}`);
			}

			// 2. Check Payout Account
			const payoutAccount = await tx.query.creatorPayoutAccounts.findFirst({
				where: eq(creatorPayoutAccounts.userId, userId),
			});

			if (
				!payoutAccount ||
				payoutAccount.verificationStatus !== "verified" ||
				!payoutAccount.stripeRecipientId
			) {
				throw new Error("Payout account not verified");
			}

			// 3. Create Payout Record
			const newPayout = await tx
				.insert(payouts)
				.values({
					userId,
					amount: amount.toString(),
					netAmount: amount.toString(),
					platformFee: "0",
					status: "pending",
				})
				.returning();

			return {
				payoutId: newPayout[0].id,
				stripeRecipientId: payoutAccount.stripeRecipientId,
			};
		});

		const { payoutId, stripeRecipientId } = result;

		// 4. Trigger Stripe Payout (Global Payouts V2 API)
		try {
			// We use the v2 moneyManagement outboundPayments create method as requested.
			// Note: The financial_account and payout_method might be needed from environment variables or account settings.
			// @ts-ignore - V2 types might be pending in some environments
			const outboundPayment = await stripe.v2.moneyManagement.outboundPayments.create({
				from: {
					financial_account: process.env.STRIPE_FINANCIAL_ACCOUNT_ID || "",
					currency: "usd",
				},
				to: {
					recipient: stripeRecipientId,
					// payout_method: process.env.STRIPE_PAYOUT_METHOD_ID, // Optional or retrieved from account
				},
				amount: {
					value: Math.round(amount * 100), // in minor units (cents)
					currency: "usd",
				},
				description: `Payout for user ${userId}`,
			});

			await db
				.update(payouts)
				.set({
					status: "processing",
					stripePayoutId: outboundPayment.id,
				})
				.where(eq(payouts.id, payoutId));

			// 5. Add to Ledger (Negative entry)
			await db.insert(earningsLedger).values({
				userId,
				transactionType: "payout",
				amount: (-amount).toString(),
				relatedPayoutId: payoutId,
				description: `Payout request ${payoutId}`,
			});

			revalidatePath("/dashboard/payouts");
			return { success: true, data: { payoutId } };
		} catch (error: any) {
			console.error("Stripe Payout Error:", error);
			await db
				.update(payouts)
				.set({
					status: "failed",
					failureMessage: error.message,
				})
				.where(eq(payouts.id, payoutId));

			throw new Error(error.message || "Payout failed");
		}
	}, input);
}