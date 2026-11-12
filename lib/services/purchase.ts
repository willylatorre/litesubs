import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/app/db";
import {
	checkoutTokens,
	creatorCustomers,
	enrollments,
	payments,
	transactions,
	user as userTable,
} from "@/app/db/schema";
import { appUrl } from "@/lib/app-url";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";
import {
	createConnectedCustomer,
	createDirectCheckoutSession,
	isValidApplicationFee,
} from "@/lib/stripe-direct-charges";
import { getPaymentReadiness } from "./connect";
import { resolvePublishedPlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";

/**
 * The one purchase path. Self-service buying and creator-requested purchase
 * links both end up here, so the fee, the Customer mapping, the receipt, and
 * the fulfillment rules cannot drift apart between transports.
 *
 * Ordering matters: the receipt row is written *before* the Stripe session so a
 * charge can never exist without a local record of what it was for.
 */

export type PurchaseInput = {
	planId: string;
	/** The buyer. Resolved by the caller from the authenticated session. */
	userId: string;
};

/**
 * The Stripe calls this service depends on. Production uses the real adapter;
 * tests substitute it at the service boundary instead of depending on Stripe's
 * HTTP behaviour. Nothing here is exposed to application callers.
 */
export type PurchaseStripeAdapter = {
	createConnectedCustomer: typeof createConnectedCustomer;
	createDirectCheckoutSession: typeof createDirectCheckoutSession;
};

export const defaultPurchaseAdapter: PurchaseStripeAdapter = {
	createConnectedCustomer,
	createDirectCheckoutSession,
};

export type PurchaseResult = {
	status: "checkout" | "needs_account";
	paymentId?: string;
	url?: string;
};

function applicationFeeFor(amount: number): number {
	const fee = Math.round(amount * PLATFORM_FEE_PERCENT);
	if (!isValidApplicationFee(fee, amount))
		throw new ServiceError(
			"CHECKOUT_UNAVAILABLE",
			"This plan's fee cannot be collected on Stripe",
			409,
		);
	return fee;
}

/**
 * Resolve (or claim) the buyer's Stripe Customer on this creator's account.
 *
 * The claim row exists before the Stripe call, so two concurrent first
 * purchases resolve to one intended Customer: one attempts, the other waits on
 * the row and reuses the result. A failed attempt releases the claim so a retry
 * is possible instead of permanently wedging the buyer.
 */
export async function ensureCreatorCustomer(
	input: {
		creatorId: string;
		userId: string;
		email: string;
		name?: string | null;
		stripeAccountId: string;
	},
	adapter: PurchaseStripeAdapter = defaultPurchaseAdapter,
) {
	const find = () =>
		db.query.creatorCustomers.findFirst({
			where: and(
				eq(creatorCustomers.creatorId, input.creatorId),
				eq(creatorCustomers.userId, input.userId),
			),
		});

	const existing = await find();
	if (
		existing?.stripeCustomerId &&
		existing.stripeAccountId === input.stripeAccountId
	)
		return existing;
	if (
		existing?.stripeAccountId &&
		existing.stripeAccountId !== input.stripeAccountId
	)
		throw new ServiceError(
			"CUSTOMER_ACCOUNT_MISMATCH",
			"This customer belongs to a different Stripe account",
			409,
		);
	if (existing?.status === "provisioning") {
		// A concurrent purchase owns the claim. Let Stripe's idempotency key make
		// a duplicate attempt harmless rather than creating a second Customer.
		const waited = await find();
		if (waited?.stripeCustomerId) return waited;
	}

	if (!existing) {
		await db
			.insert(creatorCustomers)
			.values({
				creatorId: input.creatorId,
				userId: input.userId,
				stripeAccountId: input.stripeAccountId,
				email: input.email,
				status: "provisioning",
			})
			// A concurrent insert wins; this call then falls through to reuse it.
			.onConflictDoNothing({
				target: [creatorCustomers.creatorId, creatorCustomers.userId],
			});
	}

	let customerId: string;
	try {
		const customer = await adapter.createConnectedCustomer({
			stripeAccountId: input.stripeAccountId,
			email: input.email,
			name: input.name,
			metadata: {
				litesubsUserId: input.userId,
				litesubsCreatorId: input.creatorId,
			},
			// Keyed per (account, buyer) so a retried provisioning reuses the
			// Customer Stripe already created.
			idempotencyKey: `litesubs:customer:${input.stripeAccountId}:${input.userId}`,
		});
		customerId = customer.id;
	} catch (error) {
		await db
			.update(creatorCustomers)
			.set({ status: "failed" })
			.where(
				and(
					eq(creatorCustomers.creatorId, input.creatorId),
					eq(creatorCustomers.userId, input.userId),
					isNull(creatorCustomers.stripeCustomerId),
				),
			);
		throw error instanceof ServiceError
			? error
			: new ServiceError(
					"PAYMENTS_NOT_READY",
					"Could not prepare the Stripe customer",
					502,
				);
	}

	const [saved] = await db
		.update(creatorCustomers)
		.set({
			stripeCustomerId: customerId,
			stripeAccountId: input.stripeAccountId,
			status: "ready",
		})
		.where(
			and(
				eq(creatorCustomers.creatorId, input.creatorId),
				eq(creatorCustomers.userId, input.userId),
			),
		)
		.returning();
	return saved;
}

/**
 * Start a direct-charge Checkout for one published plan.
 *
 * Only the *published* version is sold, and its own Stripe Price is used, so a
 * creator editing their draft can never change what an open checkout charges.
 */
export async function startPurchase(
	principal: Principal,
	input: PurchaseInput,
	adapter: PurchaseStripeAdapter = defaultPurchaseAdapter,
): Promise<PurchaseResult> {
	requireScope(principal, "customers:write");
	const { plan, terms } = await resolvePublishedPlan(
		principal.creatorId,
		input.planId,
	);
	if (terms.billingMode !== "one_time")
		throw new ServiceError(
			"UNSUPPORTED_BILLING_MODE",
			"Monthly plans are not purchasable yet",
			409,
		);
	// A published version always carries the objects it sells; a row without
	// them predates publication or was tampered with, and must not be charged.
	if (!terms.stripePriceId || !terms.stripeAccountId)
		throw new ServiceError(
			"PLAN_NOT_PROVISIONED",
			"This plan is not ready to sell. Republish it.",
			409,
		);

	const readiness = await getPaymentReadiness(principal.creatorId);
	if (!readiness.canSell || !readiness.stripeAccountId)
		throw new ServiceError(
			"PAYMENTS_NOT_READY",
			"This creator cannot accept payments yet",
			409,
		);
	if (readiness.stripeAccountId !== terms.stripeAccountId)
		throw new ServiceError(
			"ACCOUNT_MISMATCH",
			"This plan was published on a different Stripe account",
			409,
		);

	const user = await db.query.user.findFirst({
		where: eq(userTable.id, input.userId),
		columns: { id: true, email: true, name: true },
	});
	if (!user)
		throw new ServiceError("NOT_FOUND", "Customer account not found", 404);

	const fee = applicationFeeFor(terms.price);
	const customer = await ensureCreatorCustomer(
		{
			creatorId: principal.creatorId,
			userId: user.id,
			email: user.email,
			name: user.name,
			stripeAccountId: terms.stripeAccountId,
		},
		adapter,
	);

	const [payment] = await db
		.insert(payments)
		.values({
			creatorId: principal.creatorId,
			userId: user.id,
			planId: plan.id,
			planVersionId: terms.id,
			stripeAccountId: terms.stripeAccountId,
			stripeCustomerId: customer?.stripeCustomerId ?? null,
			status: "pending",
			credits: terms.credits,
			amountTotal: terms.price,
			currency: terms.currency,
			applicationFee: fee,
		})
		.returning();

	let session: Awaited<ReturnType<typeof createDirectCheckoutSession>>;
	try {
		session = await adapter.createDirectCheckoutSession({
			stripeAccountId: terms.stripeAccountId,
			lineItem: {
				name: plan.name,
				description: plan.description,
				unitAmount: terms.price,
				currency: terms.currency,
				stripePriceId: terms.stripePriceId,
			},
			applicationFeeAmount: fee,
			stripeCustomerId: customer?.stripeCustomerId ?? null,
			customerEmail: user.email,
			successUrl: appUrl(`/dashboard?success=true&planId=${plan.id}`),
			cancelUrl: appUrl(`/dashboard?canceled=true`),
			metadata: {
				paymentId: payment.id,
				userId: user.id,
				planId: plan.id,
				planVersionId: terms.id,
				creatorId: principal.creatorId,
				credits: String(terms.credits),
				type: "credit_purchase",
				stripeConnectAccountId: terms.stripeAccountId,
				applicationFeeAmount: String(fee),
			},
			// A retried request for the same receipt returns the original session.
			idempotencyKey: `litesubs:checkout:${payment.id}`,
		});
	} catch {
		await db
			.update(payments)
			.set({ status: "failed" })
			.where(eq(payments.id, payment.id));
		throw new ServiceError(
			"CHECKOUT_UNAVAILABLE",
			"Stripe could not start this checkout",
			502,
		);
	}

	if (!session.url) {
		await db
			.update(payments)
			.set({ status: "failed" })
			.where(eq(payments.id, payment.id));
		throw new ServiceError(
			"CHECKOUT_UNAVAILABLE",
			"No checkout URL was returned",
			502,
		);
	}
	await db
		.update(payments)
		.set({ stripeCheckoutId: session.id })
		.where(eq(payments.id, payment.id));

	return { status: "checkout", paymentId: payment.id, url: session.url };
}

/**
 * Fulfil a confirmed payment exactly once.
 *
 * This runs from the signed, account-bound webhook, never from the success
 * page. The payment row's status transition is the idempotency boundary: only
 * the delivery that flips `pending` to `paid` grants credits, so duplicate and
 * concurrent events cannot produce duplicate units or receipts.
 */
export async function fulfillPayment(input: {
	checkoutSessionId: string;
	amountPaid: number;
	paymentIntentId?: string | null;
}): Promise<{ status: "fulfilled" | "already_fulfilled"; credits: number }> {
	return db.transaction(async (tx) => {
		const [claimed] = await tx
			.update(payments)
			.set({
				status: "paid",
				amountPaid: input.amountPaid,
				stripePaymentIntentId: input.paymentIntentId ?? null,
				fulfilledAt: new Date(),
			})
			.where(
				and(
					eq(payments.stripeCheckoutId, input.checkoutSessionId),
					eq(payments.status, "pending"),
				),
			)
			.returning();
		if (!claimed) {
			const existing = await tx.query.payments.findFirst({
				where: eq(payments.stripeCheckoutId, input.checkoutSessionId),
			});
			if (!existing)
				throw new ServiceError("NOT_FOUND", "Payment not found", 404);
			// Already granted (or explicitly failed); report without writing again.
			return {
				status: "already_fulfilled" as const,
				credits: existing.credits,
			};
		}

		const [enrollment] = await tx
			.insert(enrollments)
			.values({
				userId: claimed.userId,
				planId: claimed.planId,
				creatorId: claimed.creatorId,
			})
			.onConflictDoUpdate({
				target: [enrollments.userId, enrollments.planId],
				set: { updatedAt: new Date() },
			})
			.returning();

		const [updated] = await tx
			.update(enrollments)
			.set({ credits: sql`${enrollments.credits} + ${claimed.credits}` })
			.where(eq(enrollments.id, enrollment.id))
			.returning();

		await tx.insert(transactions).values({
			userId: claimed.userId,
			creatorId: claimed.creatorId,
			planId: claimed.planId,
			planVersionId: claimed.planVersionId,
			amount: claimed.credits,
			amountMoney: input.amountPaid,
			currency: claimed.currency,
			type: "purchase",
			description: `Purchase of ${claimed.credits} credits`,
			stripeCheckoutId: input.checkoutSessionId,
			status: "completed",
			usesStripeConnect: true,
			stripeApplicationFee: claimed.applicationFee,
			stripeConnectAccountId: claimed.stripeAccountId,
			balanceBefore: enrollment.credits,
			balanceAfter: updated?.credits ?? enrollment.credits + claimed.credits,
		});

		return { status: "fulfilled" as const, credits: claimed.credits };
	});
}

/** A Checkout that expired or failed grants nothing; it only records the fact. */
export async function closePayment(
	checkoutSessionId: string,
	status: "expired" | "failed",
) {
	await db
		.update(payments)
		.set({ status })
		.where(
			and(
				eq(payments.stripeCheckoutId, checkoutSessionId),
				eq(payments.status, "pending"),
			),
		);
}

/**
 * Issue a single-use purchase request token.
 *
 * Only the hash is stored: the raw token travels in a URL, so a database dump
 * must not be replayable. `consumedAt` makes the link work exactly once.
 */
export async function issueCheckoutToken(input: {
	creatorId: string;
	userId: string;
	planId: string;
	/** Requests are short-lived; the default matches invite expiry behaviour. */
	ttlMs?: number;
}) {
	const token = crypto.randomUUID();
	const tokenHash = createHash("sha256").update(token).digest("hex");
	await db.insert(checkoutTokens).values({
		tokenHash,
		creatorId: input.creatorId,
		userId: input.userId,
		planId: input.planId,
		expiresAt: new Date(Date.now() + (input.ttlMs ?? 14 * 24 * 60 * 60 * 1000)),
	});
	return token;
}

/**
 * Consume a purchase-request token for the signed-in buyer.
 *
 * The token must belong to *this* signed-in user, be unexpired, and be unused.
 * Consumption is a conditional update so two concurrent uses cannot both
 * succeed, and a forwarded link fails because the buyer no longer matches.
 */
export async function redeemCheckoutToken(input: {
	token: string;
	userId: string;
}): Promise<{ planId: string; creatorId: string }> {
	const tokenHash = createHash("sha256").update(input.token).digest("hex");
	const consumed = await db
		.update(checkoutTokens)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(checkoutTokens.tokenHash, tokenHash),
				eq(checkoutTokens.userId, input.userId),
				isNull(checkoutTokens.consumedAt),
				gt(checkoutTokens.expiresAt, new Date()),
			),
		)
		.returning();
	const token = consumed[0];
	if (!token)
		throw new ServiceError(
			"CHECKOUT_TOKEN_INVALID",
			"This payment request is no longer valid. Ask the creator for a new link.",
			400,
		);
	return { planId: token.planId, creatorId: token.creatorId };
}

/** Read a payment for the creator/customer views, scoped to its owner. */
export async function getPayment(paymentId: string) {
	return db.query.payments.findFirst({
		where: eq(payments.id, paymentId),
		with: { plan: true },
	});
}
