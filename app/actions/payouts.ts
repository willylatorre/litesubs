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
import { appUrl } from "@/lib/app-url";
import {
	computeBalance,
	requestPayoutSchema,
	type LedgerTotalsRow,
} from "@/lib/payouts";
import { authenticatedAction } from "@/lib/safe-action";
import { getStripe } from "@/lib/stripe";

// Type for database or transaction context
type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

// Helpers

async function calculateUserBalance(tx: DbOrTx, userId: string) {
	// Calculate balance for platform payouts (non-Connect transactions only).
	// Stripe Connect transactions are NOT written to the earningsLedger because
	// those payments go directly to the creator's Stripe account, so this balance
	// only reflects funds held by the platform.
	const ledgerTotals = await tx
		.select({
			type: earningsLedger.transactionType,
			total: sql<string>`COALESCE(SUM(${earningsLedger.amount}), 0)`,
		})
		.from(earningsLedger)
		.where(eq(earningsLedger.userId, userId))
		.groupBy(earningsLedger.transactionType);

	// Pending payouts are counted separately. Only 'pending' matters because
	// 'processing' and 'completed' payout amounts are already in the ledger.
	const pendingPayoutResult = await tx
		.select({ total: sql<string>`COALESCE(SUM(${payouts.amount}), 0)` })
		.from(payouts)
		.where(and(eq(payouts.userId, userId), eq(payouts.status, "pending")));

	const pendingPayouts = parseFloat(pendingPayoutResult[0]?.total || "0");

	return computeBalance(
		ledgerTotals as LedgerTotalsRow[],
		pendingPayouts,
		PLATFORM_FEE_PERCENT,
	);
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
			refresh_url: appUrl("/dashboard/payouts?setup=refresh"),
			return_url: appUrl("/dashboard/payouts?setup=complete"),
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

		// The recipient is created through the v2 API (see setupPayoutAccount).
		// Retrieving it with the v1 `stripe.accounts.retrieve` endpoint fails,
		// which previously left every account stuck in "pending".
		const stripeAccount = await stripe.v2.core.accounts.retrieve(
			account.stripeRecipientId,
			{
				include: ["requirements", "configuration.recipient", "identity"],
			},
		);

		// A recipient is payable once its bank_accounts capability is active and
		// no required information is still outstanding.
		const bankAccounts =
			stripeAccount.configuration?.recipient?.capabilities?.bank_accounts;
		const capabilityStatuses = [
			bankAccounts?.local?.status,
			bankAccounts?.ach?.status,
			bankAccounts?.fedwire?.status,
		].filter(Boolean);
		const hasActiveCapability = capabilityStatuses.includes("active");
		const requirementsSummary =
			stripeAccount.requirements?.summary?.minimum_deadline?.status;
		const requirementsOpen = requirementsSummary === "currently_due";

		const status =
			hasActiveCapability && !requirementsOpen ? "verified" : "pending";

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
		async (session, rawInput: z.infer<typeof requestPayoutSchema>) => {
			const userId = session.user.id;

			// Validate before anything else: the previous code applied the amount
			// straight to `Math.round(amount * 100)` and Stripe without checking it.
			const parsed = requestPayoutSchema.safeParse(rawInput);
			if (!parsed.success) {
				return {
					success: false,
					error: parsed.error.issues[0]?.message ?? "Invalid payout amount",
					fieldErrors: parsed.error.flatten().fieldErrors,
				};
			}

			const { amount } = parsed.data;

			// Check if user has an active Stripe Connect account - they shouldn't use manual payouts
			const { stripeConnectAccounts } = await import(
				"@/app/db/stripe-connect-schema"
			);
			const connectAccount = await db.query.stripeConnectAccounts.findFirst({
				where: eq(stripeConnectAccounts.userId, userId),
			});

			if (connectAccount?.status === "active" && connectAccount.chargesEnabled) {
				throw new Error(
					"You have Stripe Connect enabled. Payments go directly to your Stripe account.",
				);
			}

			// 1. Validate and create payout record inside a transaction.
			// Serializable isolation is required: at the default READ COMMITTED
			// level two concurrent requests could both observe "no pending payout"
			// and each dispatch an outbound payment.
			const result = await db.transaction(
				async (tx) => {
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
							amount: amount.toFixed(2),
							netAmount: amount.toFixed(2),
							platformFee: "0.00",
							status: "pending",
						})
						.returning();

					return {
						payoutId: newPayout[0].id,
						stripeRecipientId: payoutAccount.stripeRecipientId,
					};
				},
				{ isolationLevel: "serializable" },
			);

			const { payoutId, stripeRecipientId } = result;

			// 4. Trigger Stripe Payout (Global Payouts V2 API)
			try {
				const stripe = getStripe();
				const outboundPayment =
					await stripe.v2.moneyManagement.outboundPayments.create({
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
						amount: (-amount).toFixed(2),
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
				// The v2 webhook never saw a dispatched payment, so nothing will
				// restore the reserved funds for us — reverse the ledger entry here
				// and release the reservation in the same transaction.
				await db.transaction(async (tx) => {
					await tx
						.update(payouts)
						.set({
							status: "failed",
							failureMessage: errorMessage,
						})
						.where(eq(payouts.id, payoutId));

					const existingLedger = await tx.query.earningsLedger.findFirst({
						where: and(
							eq(earningsLedger.relatedPayoutId, payoutId),
							eq(earningsLedger.transactionType, "payout"),
						),
					});

					// If the payout ledger entry was already written, reverse it.
					if (existingLedger) {
						const alreadyRestored = await tx.query.earningsLedger.findFirst({
							where: and(
								eq(earningsLedger.relatedPayoutId, payoutId),
								eq(earningsLedger.transactionType, "adjustment"),
							),
						});

						if (!alreadyRestored) {
							await tx.insert(earningsLedger).values({
								userId,
								transactionType: "adjustment",
								amount: amount.toFixed(2),
								relatedPayoutId: payoutId,
								description: `Restored balance after failed payout ${payoutId}`,
							});
						}
					}
				});

				throw new Error(errorMessage);
			}
		},
		input,
	);
}
