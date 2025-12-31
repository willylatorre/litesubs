import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MIN_PAYOUT_AMOUNT, PLATFORM_FEE_PERCENT } from "@/lib/constants";
import { stripe } from "@/lib/stripe";

// Schemas
const requestPayoutSchema = z.object({
	amount: z.number().positive().min(MIN_PAYOUT_AMOUNT),
});

const setupPayoutAccountSchema = z.object({}); // Trigger only


// Actions

export const getAccountBalance = authenticatedAction(async (session) => {
	const userId = session.user.id;

	// Calculate totals from ledger
	const ledgerEntries = await db
		.select({
			amount: earningsLedger.amount,
			type: earningsLedger.transactionType,
		})
		.from(earningsLedger)
		.where(eq(earningsLedger.userId, userId));

	let totalEarnings = 0;
	let totalPaidOut = 0;
	let pendingPayouts = 0;

	for (const entry of ledgerEntries) {
		const amount = parseFloat(entry.amount);
		if (amount > 0) {
			totalEarnings += amount;
		} else if (entry.type === "payout") {
			// Payouts are negative in ledger
			totalPaidOut += Math.abs(amount);
		}
	}

	// Calculate pending payouts separately from payout table to be accurate
	const pendingPayoutRecs = await db
		.select({ amount: payouts.amount })
		.from(payouts)
		.where(
			and(
				eq(payouts.userId, userId),
				sql`${payouts.status} IN ('pending', 'processing')`
			)
		);

	for (const p of pendingPayoutRecs) {
		pendingPayouts += parseFloat(p.amount);
	}

	// Platform fees are deducted from Gross Earnings
	const platformFees = totalEarnings * PLATFORM_FEE_PERCENT;

	// Available = Total Earnings - Fees - Total Paid Out (completed) - Pending Payouts
	// Note: If ledger includes "payout" entries, they are negative.
	// So Sum(Ledger) = Total Earnings - Total Paid Out.
	// Available = Sum(Ledger) - Fees - Pending Payouts (if not yet in ledger)
	// Wait, the prompt says: "Create negative entry in earnings_ledger" when payout is requested/processed.
	// If we create it immediately on request, then it's already deducted.
	// Let's check "requestPayout" logic below.
	// If we add to ledger on request, then Available = Sum(Ledger) - Fees.

	// Let's assume we add to ledger only when 'processing' or 'completed'.
	// Actually, strictly following "Available Balance = Total Earnings - Platform Fees - Previous Payouts - Pending Payouts"
	// Total Earnings = Sum(positive ledger entries)
	// Previous Payouts = Sum(negative ledger entries)
	// Pending Payouts = Sum(payouts table where status is pending)

	const availableBalance =
		totalEarnings - platformFees - totalPaidOut - pendingPayouts;

	return {
		success: true,
		data: {
			totalEarnings,
			platformFees,
			totalPaidOut,
			pendingPayouts,
			availableBalance: Math.max(0, availableBalance), // No negative balance display
			canRequestPayout: availableBalance >= MIN_PAYOUT_AMOUNT,
			minimumPayout: MIN_PAYOUT_AMOUNT,
		},
	};
});

export const getPayoutAccount = authenticatedAction(async (session) => {
	const account = await db.query.creatorPayoutAccounts.findFirst({
		where: eq(creatorPayoutAccounts.userId, session.user.id),
	});
	return { success: true, data: account };
});

export const getPayoutHistory = authenticatedAction(async (session) => {
	const history = await db.query.payouts.findMany({
		where: eq(payouts.userId, session.user.id),
		orderBy: [desc(payouts.createdAt)],
	});
	return { success: true, data: history };
});

export const setupPayoutAccount = authenticatedAction(async (session) => {
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

export const syncPayoutAccountStatus = authenticatedAction(async (session) => {
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


export const requestPayout = authenticatedAction(
	async (session, input: z.infer<typeof requestPayoutSchema>) => {
		const userId = session.user.id;
		const { amount } = input;

		// 1. Re-validate Balance inside a transaction
		const result = await db.transaction(async (tx) => {
			const ledgerEntries = await tx
				.select({
					amount: earningsLedger.amount,
					type: earningsLedger.transactionType,
				})
				.from(earningsLedger)
				.where(eq(earningsLedger.userId, userId));

			let totalEarnings = 0;
			let totalPaidOut = 0;
			for (const entry of ledgerEntries) {
				const amt = parseFloat(entry.amount);
				if (amt > 0) totalEarnings += amt;
				else if (entry.type === "payout") totalPaidOut += Math.abs(amt);
			}
			const pendingPayoutRecs = await tx
				.select({ amount: payouts.amount })
				.from(payouts)
				.where(
					and(
						eq(payouts.userId, userId),
						sql`${payouts.status} IN ('pending', 'processing')`,
					),
				);
			const pendingPayouts = pendingPayoutRecs.reduce(
				(sum, p) => sum + parseFloat(p.amount),
				0,
			);
			const platformFees = totalEarnings * PLATFORM_FEE_PERCENT;
			const availableBalance =
				totalEarnings - platformFees - totalPaidOut - pendingPayouts;

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
			            		} catch (error: any) {			console.error("Stripe Payout Error:", error);
			await db
				.update(payouts)
				.set({
					status: "failed",
					failureMessage: error.message,
				})
				.where(eq(payouts.id, payoutId));

			throw new Error(error.message || "Payout failed");
		}
	},
);

