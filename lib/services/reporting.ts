import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/app/db";
import { payments, subscriptionInvoices, subscriptions } from "@/app/db/schema";

/**
 * Money reporting, derived from receipts rather than credit-ledger rows.
 *
 * Why this exists: a "purchase" transaction is a credit grant, not a sale. It
 * carries the intended money for convenience, but it cannot answer what a
 * creator actually earned — pending Checkouts have no row yet, refunds reduce
 * money without adding a transaction, and one customer can be billed in two
 * currencies. Summing those rows mixed units and silently ignored refunds.
 *
 * Rules stated once, so every surface agrees:
 * - Gross is confirmed money: a paid or refunded receipt with `amount_paid`.
 *   Pending/expired/failed Checkouts never count.
 * - Refunded is the succeeded refund total stored on the receipt.
 * - Net is gross minus refunded.
 * - Values are grouped per currency; USD and EUR are never added together.
 * - Manual grants and comps are not money and never appear here.
 */
export type MoneyByCurrency = {
	currency: string;
	/** Confirmed money collected, in minor units. */
	gross: number;
	/** Succeeded refunds, in minor units. */
	refunded: number;
	/** Gross minus refunded, in minor units. */
	net: number;
	/** Platform application fees actually attached to these receipts. */
	platformFees: number;
};

type Party = {
	kind: "creator" | "customer";
	id: string;
	/** Narrows a customer's total to one creator's receipts. */
	creatorId?: string;
	/** Narrows any total to one plan's receipts. */
	planId?: string;
};

function merge(
	rows: {
		currency: string;
		gross: number;
		refunded: number;
		fees: number;
	}[],
): MoneyByCurrency[] {
	const totals = new Map<
		string,
		{ gross: number; refunded: number; fees: number }
	>();
	for (const row of rows) {
		const current = totals.get(row.currency) ?? {
			gross: 0,
			refunded: 0,
			fees: 0,
		};
		current.gross += Number(row.gross ?? 0);
		current.refunded += Number(row.refunded ?? 0);
		current.fees += Number(row.fees ?? 0);
		totals.set(row.currency, current);
	}
	return [...totals.entries()]
		.map(([currency, value]) => ({
			currency,
			gross: value.gross,
			refunded: value.refunded,
			net: value.gross - value.refunded,
			platformFees: value.fees,
		}))
		.sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Confirmed one-time money, grouped by currency. */
async function paymentMoney(party: Party): Promise<MoneyByCurrency[]> {
	const filters = [
		party.kind === "creator"
			? eq(payments.creatorId, party.id)
			: eq(payments.userId, party.id),
	];
	if (party.kind === "customer" && party.creatorId)
		filters.push(eq(payments.creatorId, party.creatorId));
	if (party.planId) filters.push(eq(payments.planId, party.planId));
	const rows = await db
		.select({
			currency: payments.currency,
			gross: sql<number>`coalesce(sum(${payments.amountPaid}), 0)::int`,
			refunded: sql<number>`coalesce(sum(${payments.amountRefunded}), 0)::int`,
			fees: sql<number>`coalesce(sum(${payments.applicationFee}), 0)::int`,
		})
		.from(payments)
		.where(
			and(
				...filters,
				inArray(payments.status, ["paid", "refunded"]),
				sql`${payments.amountPaid} is not null`,
			),
		)
		.groupBy(payments.currency);
	return merge(rows);
}

/** Confirmed recurring money, grouped by currency. */
async function invoiceMoney(party: Party): Promise<MoneyByCurrency[]> {
	const filters = [
		party.kind === "creator"
			? eq(subscriptions.creatorId, party.id)
			: eq(subscriptions.userId, party.id),
	];
	if (party.kind === "customer" && party.creatorId)
		filters.push(eq(subscriptions.creatorId, party.creatorId));
	if (party.planId) filters.push(eq(subscriptions.planId, party.planId));
	const rows = await db
		.select({
			currency: subscriptionInvoices.currency,
			gross: sql<number>`coalesce(sum(${subscriptionInvoices.amountPaid}), 0)::int`,
			refunded: sql<number>`coalesce(sum(${subscriptionInvoices.amountRefunded}), 0)::int`,
			// The fee rate is stored as a percent of each invoice.
			fees: sql<number>`coalesce(sum(round(${subscriptionInvoices.amountPaid} * ${subscriptions.applicationFeePercent} / 100.0)), 0)::int`,
		})
		.from(subscriptionInvoices)
		.innerJoin(
			subscriptions,
			eq(subscriptions.id, subscriptionInvoices.subscriptionId),
		)
		.where(and(...filters))
		.groupBy(subscriptionInvoices.currency);
	return merge(rows);
}

/** Combined receipt-derived money for one creator or customer. */
export async function moneyByCurrency(party: Party) {
	const [oneTime, recurring] = await Promise.all([
		paymentMoney(party),
		invoiceMoney(party),
	]);
	return merge(
		[...oneTime, ...recurring].map((row) => ({
			currency: row.currency,
			gross: row.gross,
			refunded: row.refunded,
			fees: row.platformFees,
		})),
	);
}

/** True when any currency has money worth showing. */
export function hasMoney(money: MoneyByCurrency[]) {
	return money.some((row) => row.gross > 0 || row.refunded > 0);
}
