import { z } from "zod";
import { MIN_PAYOUT_AMOUNT } from "@/lib/constants";

/**
 * Payout request validation.
 *
 * Extracted from the server action so it can be tested without touching the
 * database or Stripe. `requestPayout` previously declared this schema and never
 * called it, letting `NaN` and negatives reach Stripe.
 */
export const requestPayoutSchema = z.object({
	amount: z
		.number()
		.finite("Amount must be a number")
		.positive("Amount must be positive")
		.min(MIN_PAYOUT_AMOUNT, `Minimum payout is $${MIN_PAYOUT_AMOUNT}`)
		// Payouts are sent in cents, so anything finer than 2dp would be silently
		// rounded by Stripe.
		.refine(
			(value) =>
				Number.isInteger(Math.round(value * 100)) &&
				value === Math.round(value * 100) / 100,
			"Amount cannot have more than 2 decimal places",
		),
});

export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export type BalanceTotals = {
	totalEarnings: number;
	platformFees: number;
	totalPaidOut: number;
	totalRefunds: number;
	pendingPayouts: number;
	availableBalance: number;
};

export type LedgerTotalsRow = {
	type: "sale" | "payout" | "refund" | "adjustment";
	total: string;
};

/**
 * Pure balance calculation, mirroring `calculateUserBalance` in the payouts
 * action. Kept free of database access so the money math can be tested.
 */
export function computeBalance(
	ledgerRows: LedgerTotalsRow[],
	pendingPayoutsTotal: number,
	platformFeePercent: number,
): BalanceTotals {
	let totalEarnings = 0;
	let totalPaidOut = 0;
	let totalRefunds = 0;
	let totalAdjustments = 0;

	for (const row of ledgerRows) {
		const amount = Number.parseFloat(row.total);
		if (!Number.isFinite(amount)) continue;

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

	const platformFees = totalEarnings * platformFeePercent;
	const availableBalance =
		totalEarnings -
		platformFees -
		totalPaidOut -
		totalRefunds +
		totalAdjustments -
		pendingPayoutsTotal;

	return {
		totalEarnings,
		platformFees,
		totalPaidOut,
		totalRefunds,
		pendingPayouts: pendingPayoutsTotal,
		availableBalance,
	};
}

/**
 * Map a Stripe v2 outbound payment event type to a local payout status.
 * Returns null for events this app does not act on.
 */
export function mapOutboundPaymentEvent(
	eventType: string,
): "completed" | "failed" | "cancelled" | null {
	switch (eventType) {
		case "v2.money_management.outbound_payment.posted":
			return "completed";
		case "v2.money_management.outbound_payment.failed":
		case "v2.money_management.outbound_payment.returned":
			return "failed";
		case "v2.money_management.outbound_payment.canceled":
			return "cancelled";
		default:
			return null;
	}
}
