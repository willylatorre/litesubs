import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_PAYOUT_AMOUNT, PLATFORM_FEE_PERCENT } from "@/lib/constants";
import {
	computeBalance,
	type LedgerTotalsRow,
	mapOutboundPaymentEvent,
	requestPayoutSchema,
} from "@/lib/payouts";

describe("requestPayoutSchema", () => {
	const valid = (amount: unknown) => requestPayoutSchema.safeParse({ amount });

	it("accepts the minimum payout amount", () => {
		assert.equal(valid(MIN_PAYOUT_AMOUNT).success, true);
	});

	it("accepts a normal amount with cents", () => {
		assert.equal(valid(123.45).success, true);
	});

	it("rejects amounts below the minimum", () => {
		assert.equal(valid(MIN_PAYOUT_AMOUNT - 0.01).success, false);
	});

	it("rejects zero and negative amounts", () => {
		assert.equal(valid(0).success, false);
		assert.equal(valid(-100).success, false);
	});

	it("rejects NaN and Infinity", () => {
		assert.equal(valid(Number.NaN).success, false);
		assert.equal(valid(Number.POSITIVE_INFINITY).success, false);
	});

	it("rejects non-numeric input", () => {
		assert.equal(valid("100").success, false);
		assert.equal(valid(null).success, false);
		assert.equal(valid(undefined).success, false);
	});

	it("rejects sub-cent precision that Stripe would round", () => {
		assert.equal(valid(100.001).success, false);
	});
});

describe("computeBalance", () => {
	const rows = (entries: LedgerTotalsRow[]) => entries;

	it("returns zero for an empty ledger", () => {
		const b = computeBalance([], 0, PLATFORM_FEE_PERCENT);
		assert.equal(b.totalEarnings, 0);
		assert.equal(b.platformFees, 0);
		assert.equal(b.availableBalance, 0);
	});

	it("deducts the configured platform fee from sales", () => {
		const b = computeBalance(
			rows([{ type: "sale", total: "100.00" }]),
			0,
			PLATFORM_FEE_PERCENT,
		);
		assert.equal(b.totalEarnings, 100);
		assert.equal(b.platformFees, 100 * PLATFORM_FEE_PERCENT);
		assert.equal(b.availableBalance, 100 * (1 - PLATFORM_FEE_PERCENT));
	});

	it("subtracts completed payouts via the ledger", () => {
		const b = computeBalance(
			rows([
				{ type: "sale", total: "100.00" },
				{ type: "payout", total: "-40.00" },
			]),
			0,
			PLATFORM_FEE_PERCENT,
		);
		assert.equal(b.totalPaidOut, 40);
		assert.equal(b.availableBalance, 100 * (1 - PLATFORM_FEE_PERCENT) - 40);
	});

	it("deducts pending payouts so the same funds cannot be requested twice", () => {
		const b = computeBalance(
			rows([{ type: "sale", total: "100.00" }]),
			30,
			PLATFORM_FEE_PERCENT,
		);
		assert.equal(b.pendingPayouts, 30);
		assert.equal(b.availableBalance, 100 * (1 - PLATFORM_FEE_PERCENT) - 30);
	});

	it("applies adjustments, including restored balances", () => {
		const b = computeBalance(
			rows([
				{ type: "sale", total: "100.00" },
				{ type: "payout", total: "-40.00" },
				{ type: "adjustment", total: "40.00" },
			]),
			0,
			PLATFORM_FEE_PERCENT,
		);
		assert.equal(
			b.availableBalance,
			100 * (1 - PLATFORM_FEE_PERCENT) - 40 + 40,
		);
	});

	it("can report a negative balance when refunds exceed earnings", () => {
		const b = computeBalance(
			rows([
				{ type: "sale", total: "100.00" },
				{ type: "refund", total: "-500.00" },
			]),
			0,
			PLATFORM_FEE_PERCENT,
		);
		assert.equal(b.totalRefunds, 500);
		assert.ok(b.availableBalance < 0);
	});

	it("ignores non-numeric ledger totals instead of producing NaN", () => {
		const b = computeBalance(
			rows([
				{ type: "sale", total: "abc" },
				{ type: "payout", total: "-10.00" },
			]),
			0,
			PLATFORM_FEE_PERCENT,
		);
		assert.ok(Number.isFinite(b.availableBalance));
	});
});

describe("mapOutboundPaymentEvent", () => {
	it("maps posted to completed", () => {
		assert.equal(
			mapOutboundPaymentEvent("v2.money_management.outbound_payment.posted"),
			"completed",
		);
	});

	it("maps failed and returned to failed", () => {
		assert.equal(
			mapOutboundPaymentEvent("v2.money_management.outbound_payment.failed"),
			"failed",
		);
		assert.equal(
			mapOutboundPaymentEvent("v2.money_management.outbound_payment.returned"),
			"failed",
		);
	});

	it("maps canceled to cancelled", () => {
		assert.equal(
			mapOutboundPaymentEvent("v2.money_management.outbound_payment.canceled"),
			"cancelled",
		);
	});

	it("ignores unrelated events, including v1 payout events", () => {
		assert.equal(mapOutboundPaymentEvent("payout.paid"), null);
		assert.equal(
			mapOutboundPaymentEvent("v2.money_management.outbound_payment.created"),
			null,
		);
		assert.equal(
			mapOutboundPaymentEvent(
				"v2.money_management.outbound_payment.under_review",
			),
			null,
		);
	});
});
