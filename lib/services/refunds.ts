import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	creditAllocations,
	creditGrants,
	enrollments,
	payments,
	refunds,
	subscriptionInvoices,
	transactions,
} from "@/app/db/schema";
import { usableBalance } from "./credits";
import { ServiceError } from "./principal";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type RefundTarget =
	| {
			kind: "payment";
			id: string;
			creatorId: string;
			userId: string;
			stripeAccountId: string;
			currency: string;
			amountPaid: number;
			amountRefunded: number;
			sourceTransactionId: string | null;
			status: string;
	  }
	| {
			kind: "invoice";
			id: string;
			creatorId: string;
			userId: string;
			stripeAccountId: string;
			currency: string;
			amountPaid: number;
			amountRefunded: number;
			sourceTransactionId: string | null;
			status: "paid";
	  };

/**
 * A refund is money Stripe returned, not a credit policy.
 *
 * Rules this service owns, and why:
 * - A refund may be delivered repeatedly or after another refund, so the
 *   account-scoped refund id is the idempotency boundary.
 * - Only the *remaining* units of the refunded purchase are revoked. Consumed
 *   units stay in the ledger, expired units are already zero, and no other
 *   pack, period, or manual grant is touched.
 * - Partial refunds change money totals only. Converting money into units is a
 *   product decision the creator makes explicitly, so we never guess it.
 * - Reaching the full paid amount through several refunds applies the full rule
 *   exactly once, because the transition is computed from stored totals.
 * - Revocation runs inside the same transaction as the financial update, with
 *   the grants locked, so a refund racing consumption cannot overspend or
 *   resurrect units.
 * - A refund that arrives before purchase fulfillment marks the receipt as
 *   refunded, which prevents a later fulfillment from granting spendable units.
 */
export async function applyPaymentRefund(input: {
	stripeAccountId: string;
	stripeRefundId: string;
	amount: number;
	currency: string;
	/** Resolves the receipt on the owning account. */
	paymentIntentId?: string | null;
	/**
	 * Local receipt id from the PaymentIntent metadata. Used when `charge.refunded`
	 * arrives before the confirming webhook stored the PaymentIntent locally.
	 */
	fallbackPaymentId?: string | null;
}): Promise<{
	status: "recorded" | "already_recorded" | "ignored";
	revokedCredits: number;
	requiresAdjustment: boolean;
}> {
	if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
		throw new ServiceError("INVALID_REFUND", "Refund amount is invalid", 400);

	return db.transaction(async (tx) => {
		const existing = await tx.query.refunds.findFirst({
			where: and(
				eq(refunds.stripeAccountId, input.stripeAccountId),
				eq(refunds.stripeRefundId, input.stripeRefundId),
			),
			columns: { id: true, revokedCredits: true },
		});
		if (existing)
			return {
				status: "already_recorded" as const,
				revokedCredits: existing.revokedCredits,
				requiresAdjustment: false,
			};

		const target = await resolveTarget(tx, input);
		if (!target)
			// A refund for a charge this workspace never recorded is not ours to
			// reconcile; do not invent a receipt from partial data.
			return {
				status: "ignored" as const,
				revokedCredits: 0,
				requiresAdjustment: false,
			};
		if (target.currency !== input.currency)
			throw new ServiceError(
				"REFUND_CURRENCY_MISMATCH",
				"Refund currency does not match the receipt",
				409,
			);

		const sourceTransactionId =
			target.sourceTransactionId ?? (await findSourceTransaction(tx, target));

		// Refund before fulfillment: record it and stop the receipt from ever
		// becoming a grant. A later fulfillment claim requires status `pending`,
		// so marking it refunded now permanently closes that path.
		if (target.kind === "payment" && target.status === "pending") {
			await tx
				.update(payments)
				.set({
					status: "refunded",
					amountRefunded: Math.min(input.amount, target.amountPaid),
					refundedAt: new Date(),
				})
				.where(eq(payments.id, target.id));
			await tx.insert(refunds).values({
				paymentId: target.id,
				creatorId: target.creatorId,
				userId: target.userId,
				stripeAccountId: input.stripeAccountId,
				stripeRefundId: input.stripeRefundId,
				amount: input.amount,
				currency: target.currency as "usd" | "eur",
				revokedCredits: 0,
			});
			return {
				status: "recorded" as const,
				revokedCredits: 0,
				requiresAdjustment: false,
			};
		}

		const nextRefunded = target.amountRefunded + input.amount;
		if (nextRefunded > target.amountPaid)
			throw new ServiceError(
				"REFUND_EXCEEDS_PAYMENT",
				"Refund exceeds the recorded payment amount",
				409,
			);
		const fullRefund = nextRefunded >= target.amountPaid;

		const revoked = fullRefund
			? await revokeRemainingCredits(tx, {
					target,
					sourceTransactionId,
					refundAmount: input.amount,
					fullRefund,
					stripeRefundId: input.stripeRefundId,
				})
			: 0;

		await tx.insert(refunds).values({
			paymentId: target.kind === "payment" ? target.id : null,
			subscriptionInvoiceId: target.kind === "invoice" ? target.id : null,
			creatorId: target.creatorId,
			userId: target.userId,
			stripeAccountId: input.stripeAccountId,
			stripeRefundId: input.stripeRefundId,
			amount: input.amount,
			currency: target.currency as "usd" | "eur",
			revokedCredits: revoked,
		});

		if (target.kind === "payment") {
			await tx
				.update(payments)
				.set({
					status: fullRefund ? "refunded" : "paid",
					amountRefunded: nextRefunded,
					refundedAt: fullRefund ? new Date() : null,
				})
				.where(eq(payments.id, target.id));
		} else {
			await tx
				.update(subscriptionInvoices)
				.set({
					amountRefunded: nextRefunded,
					refundedAt: fullRefund ? new Date() : null,
				})
				.where(eq(subscriptionInvoices.id, target.id));
		}

		return {
			status: "recorded" as const,
			revokedCredits: revoked,
			requiresAdjustment: !fullRefund,
		};
	});
}

async function resolveTarget(
	tx: Tx,
	input: {
		stripeAccountId: string;
		paymentIntentId?: string | null;
		fallbackPaymentId?: string | null;
	},
): Promise<RefundTarget | undefined> {
	const byIntent = input.paymentIntentId
		? await tx.query.payments.findFirst({
				where: and(
					eq(payments.stripeAccountId, input.stripeAccountId),
					eq(payments.stripePaymentIntentId, input.paymentIntentId),
				),
			})
		: undefined;
	const payment =
		byIntent ??
		(input.fallbackPaymentId
			? await tx.query.payments.findFirst({
					where: and(
						eq(payments.id, input.fallbackPaymentId),
						eq(payments.stripeAccountId, input.stripeAccountId),
					),
				})
			: undefined);
	if (payment) {
		const source = payment.stripeCheckoutId
			? await tx.query.transactions.findFirst({
					where: eq(transactions.stripeCheckoutId, payment.stripeCheckoutId),
					columns: { id: true },
				})
			: undefined;
		return {
			kind: "payment",
			id: payment.id,
			creatorId: payment.creatorId,
			userId: payment.userId,
			stripeAccountId: payment.stripeAccountId,
			currency: payment.currency,
			amountPaid: payment.amountPaid ?? payment.amountTotal,
			amountRefunded: payment.amountRefunded,
			sourceTransactionId: source?.id ?? null,
			status: payment.status,
		};
	}
	if (!input.paymentIntentId) return undefined;

	const invoice = await tx.query.subscriptionInvoices.findFirst({
		where: and(
			eq(subscriptionInvoices.stripeAccountId, input.stripeAccountId),
			eq(subscriptionInvoices.stripePaymentIntentId, input.paymentIntentId),
		),
		with: {
			subscription: {
				columns: { creatorId: true, userId: true },
			},
		},
	});
	if (!invoice?.subscription) return undefined;
	const source = await tx.query.transactions.findFirst({
		where: eq(transactions.subscriptionInvoiceId, invoice.id),
		columns: { id: true },
	});
	return {
		kind: "invoice",
		id: invoice.id,
		creatorId: invoice.subscription.creatorId,
		userId: invoice.subscription.userId,
		stripeAccountId: invoice.stripeAccountId,
		currency: invoice.currency,
		amountPaid: invoice.amountPaid,
		amountRefunded: invoice.amountRefunded,
		sourceTransactionId: source?.id ?? null,
		status: "paid",
	};
}

async function findSourceTransaction(tx: Tx, target: RefundTarget) {
	if (target.kind === "payment") {
		const payment = await tx.query.payments.findFirst({
			where: eq(payments.id, target.id),
			columns: { stripeCheckoutId: true },
		});
		if (!payment?.stripeCheckoutId) return null;
		const entry = await tx.query.transactions.findFirst({
			where: eq(transactions.stripeCheckoutId, payment.stripeCheckoutId),
			columns: { id: true },
		});
		return entry?.id ?? null;
	}
	const entry = await tx.query.transactions.findFirst({
		where: eq(transactions.subscriptionInvoiceId, target.id),
		columns: { id: true },
	});
	return entry?.id ?? null;
}

/**
 * Revoke what is still spendable from the refunded receipt only.
 *
 * Locked grant rows serialize this against consumption. Zero-remaining grants
 * (already spent or expired) are skipped, so history stays truthful and the
 * balance never becomes negative or represents fictional debt.
 */
async function revokeRemainingCredits(
	tx: Tx,
	input: {
		target: RefundTarget;
		sourceTransactionId: string | null;
		refundAmount: number;
		fullRefund: boolean;
		stripeRefundId: string;
	},
) {
	if (!input.sourceTransactionId) return 0;
	const grants = await tx
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.sourceTransactionId, input.sourceTransactionId))
		.for("update");
	const revocable = grants.reduce(
		(sum, grant) => sum + Math.max(grant.remaining, 0),
		0,
	);
	if (revocable === 0) return 0;

	const enrollment = await tx.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, input.target.userId),
			eq(enrollments.planId, grants[0].planId),
		),
		columns: { id: true, credits: true },
	});
	if (!enrollment) return 0;
	const balanceBefore = await usableBalance(tx, enrollment.id);

	const [entry] = await tx
		.insert(transactions)
		.values({
			userId: input.target.userId,
			creatorId: input.target.creatorId,
			planId: grants[0].planId,
			planVersionId: grants[0].planVersionId,
			amount: -revocable,
			amountMoney: -input.refundAmount,
			currency: input.target.currency as "usd" | "eur",
			type: "refund",
			status: "completed",
			description: `Refund revoked ${revocable} unspent credit(s)`,
			idempotencyKey: `refund:${input.stripeRefundId}`,
			balanceBefore,
			balanceAfter: Math.max(balanceBefore - revocable, 0),
		})
		.returning({ id: transactions.id });

	const allocations: { grantId: string; amount: number }[] = [];
	for (const grant of grants) {
		if (grant.remaining <= 0) continue;
		allocations.push({ grantId: grant.id, amount: grant.remaining });
		await tx
			.update(creditGrants)
			.set({ remaining: 0 })
			.where(eq(creditGrants.id, grant.id));
	}
	await tx.insert(creditAllocations).values(
		allocations.map((allocation) => ({
			transactionId: entry.id,
			grantId: allocation.grantId,
			creatorId: input.target.creatorId,
			amount: allocation.amount,
		})),
	);
	// The projection is derived from usable grants, so recompute rather than
	// Recompute from usable grants so an expired unit is never subtracted twice.
	await tx
		.update(enrollments)
		.set({ credits: await usableBalance(tx, enrollment.id) })
		.where(eq(enrollments.id, enrollment.id));
	return revocable;
}
