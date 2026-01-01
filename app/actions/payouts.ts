"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/app/db";
import {
	creatorPayoutAccounts,
	earningsLedger,
	payouts,
} from "@/app/db/payouts-schema";
import { MIN_PAYOUT_AMOUNT, PLATFORM_FEE_PERCENT } from "@/lib/constants";
import { authenticatedAction } from "@/lib/safe-action";
import { getStripe } from "@/lib/stripe";

// Schemas
const requestPayoutSchema = z.object({
	amount: z.number().positive().min(MIN_PAYOUT_AMOUNT),
});

// Type for database or transaction context
type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

// Helpers

async function calculateUserBalance(tx: DbOrTx, userId: string) {
	// Use SQL aggregation for efficiency - groups by transaction type and sums amounts
	const ledgerTotals = await tx
		.select({
			type: earningsLedger.transactionType,
			total: sql<string>`COALESCE(SUM(${earningsLedger.amount}), 0)`,
		})
		.from(earningsLedger)
		.where(eq(earningsLedger.userId, userId))
		.groupBy(earningsLedger.transactionType);

	let totalEarnings = 0;
	let totalPaidOut = 0;
	let totalRefunds = 0;
	let totalAdjustments = 0;

	for (const row of ledgerTotals) {
		const amount = parseFloat(row.total);
		switch (row.type) {
			case "sale":
				totalEarnings = amount;
				break;
			case "payout":
				totalPaidOut = Math.abs(amount);
				break;
			case "refund":
				totalRefunds = Math.abs(amount);
				break;
			case "adjustment":
				totalAdjustments = amount;
				break;
		}
	}

	// Calculate pending payouts separately from payout table
	// Only count 'pending' status because 'processing' and 'completed' are already in the ledger
	const pendingPayoutResult = await tx
		.select({ total: sql<string>`COALESCE(SUM(${payouts.amount}), 0)` })
		.from(payouts)
		.where(and(eq(payouts.userId, userId), eq(payouts.status, "pending")));

	const pendingPayouts = parseFloat(pendingPayoutResult[0]?.total || "0");

	const platformFees = totalEarnings * PLATFORM_FEE_PERCENT;
	const availableBalance =
		totalEarnings -
		platformFees -
		totalPaidOut -
		totalRefunds +
		totalAdjustments -
		pendingPayouts;

	return {
		totalEarnings,
		platformFees,
		totalPaidOut,
		totalRefunds,
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
				platformFeePercent: PLATFORM_FEE_PERCENT * 100, // Return as percentage (e.g., 10 for 10%)
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
		let stripe;
		try {
			stripe = getStripe();
		} catch {
			return { success: false, error: "Stripe is not configured" };
		}

		const userId = session.user.id;
		const userEmail = session.user.email;

		// 1. Check if local record exists
		const account = await db.query.creatorPayoutAccounts.findFirst({
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
		let stripe;
		try {
			stripe = getStripe();
		} catch {
			return { success: false, error: "Stripe is not configured" };
		}

		const account = await db.query.creatorPayoutAccounts.findFirst({
			where: eq(creatorPayoutAccounts.userId, session.user.id),
		});

		if (!account?.stripeRecipientId)
			return { success: false, error: "No account" };

		const stripeAccount = await stripe.accounts.retrieve(
			account.stripeRecipientId,
		);

		const isEnabled =
			stripeAccount.payouts_enabled && stripeAccount.charges_enabled;
		// Note: details_submitted is strictly for onboarding completion
		const status = stripeAccount.details_submitted
			? isEnabled
				? "verified"
				: "pending"
			: "pending";

		await db
			.update(creatorPayoutAccounts)
			.set({ verificationStatus: status })
			.where(eq(creatorPayoutAccounts.userId, session.user.id));

		revalidatePath("/dashboard/payouts");
		return { success: true, data: { status } };
	});
}

export async function requestPayout(
	input: z.infer<typeof requestPayoutSchema>,
) {
	return authenticatedAction(
		async (session, input: z.infer<typeof requestPayoutSchema>) => {
			const userId = session.user.id;
			const { amount } = input;

			// 1. Validate and create payout record inside a transaction
			const result = await db.transaction(async (tx) => {
				const { availableBalance, pendingPayouts } = await calculateUserBalance(
					tx,
					userId,
				);

				// Check for existing pending payouts
				if (pendingPayouts > 0) {
					throw new Error(
						"You already have a pending payout request. Please wait for it to complete.",
					);
				}

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
				// The stable Stripe SDK types don't currently expose all v2 "moneyManagement" APIs.
				// Use a narrow runtime-checked escape hatch so `next build` (which runs TS) succeeds
				// while still failing loudly at runtime if the method isn't available.
				const stripe = getStripe() as unknown as {
					v2?: {
						moneyManagement?: {
							outboundPayments?: {
								create?: (params: unknown) => Promise<{ id: string }>;
							};
						};
					};
				};

				const createOutboundPayment = stripe.v2?.moneyManagement?.outboundPayments?.create;
				if (!createOutboundPayment) {
					throw new Error(
						"Stripe SDK does not support v2 moneyManagement outboundPayments in this build. Update the payout implementation or use a Stripe SDK version that supports this API."
					);
				}

				const outboundPayment = await createOutboundPayment({
						from: {
							financial_account: process.env.STRIPE_FINANCIAL_ACCOUNT_ID || "",
							currency: "usd",
						},
						to: {
							recipient: stripeRecipientId,
						},
						amount: {
							value: Math.round(amount * 100), // in minor units (cents)
							currency: "usd",
						},
						description: `Payout for user ${userId}`,
					});

				// 5. Update status and add ledger entry atomically
				await db.transaction(async (tx) => {
					await tx
						.update(payouts)
						.set({
							status: "processing",
							stripePayoutId: outboundPayment.id,
						})
						.where(eq(payouts.id, payoutId));

					await tx.insert(earningsLedger).values({
						userId,
						transactionType: "payout",
						amount: (-amount).toString(),
						relatedPayoutId: payoutId,
						description: `Payout request ${payoutId}`,
					});
				});

				revalidatePath("/dashboard/payouts");
				return { success: true, data: { payoutId } };
			} catch (error: unknown) {
				console.error("Stripe Payout Error:", error);
				const errorMessage =
					error instanceof Error ? error.message : "Payout failed";
				await db
					.update(payouts)
					.set({
						status: "failed",
						failureMessage: errorMessage,
					})
					.where(eq(payouts.id, payoutId));

				throw new Error(errorMessage);
			}
		},
		input,
	);
}
