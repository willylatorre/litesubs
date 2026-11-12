import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/app/db";
import {
	checkoutTokens,
	creatorCustomers,
	enrollments,
	payments,
	planVersions,
	subscriptionInvoices,
	subscriptions,
	transactions,
	user as userTable,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { appUrl } from "@/lib/app-url";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";
import {
	createConnectedCustomer,
	createDirectCheckoutSession,
	createDirectSubscriptionCheckoutSession,
	isValidApplicationFee,
} from "@/lib/stripe-direct-charges";
import { getPaymentReadiness } from "./connect";
import { grantCredits, usableBalance } from "./credits";
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

export type SubscriptionStripeAdapter = {
	createConnectedCustomer: typeof createConnectedCustomer;
	createDirectSubscriptionCheckoutSession: typeof createDirectSubscriptionCheckoutSession;
};

export const defaultPurchaseAdapter: PurchaseStripeAdapter = {
	createConnectedCustomer,
	createDirectCheckoutSession,
};

export const defaultSubscriptionAdapter: SubscriptionStripeAdapter = {
	createConnectedCustomer,
	createDirectSubscriptionCheckoutSession,
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
	adapter: Pick<
		PurchaseStripeAdapter,
		"createConnectedCustomer"
	> = defaultPurchaseAdapter,
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
			"Monthly plans must be started as a subscription",
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
 * Start a monthly Checkout on the plan owner's connected account. Monthly sales
 * are intentionally restricted to sandbox-connected accounts until the monthly
 * live-release gate is complete. A partial unique index and a creator/customer/plan lock
 * ensure duplicate requests reuse one pending Checkout instead of creating
 * multiple subscriptions.
 */
export async function startSubscription(
	principal: Principal,
	input: PurchaseInput,
	adapter: SubscriptionStripeAdapter = defaultSubscriptionAdapter,
): Promise<PurchaseResult> {
	requireScope(principal, "customers:write");
	const { plan, terms } = await resolvePublishedPlan(
		principal.creatorId,
		input.planId,
	);
	if (terms.billingMode !== "recurring" || terms.interval !== "month")
		throw new ServiceError(
			"UNSUPPORTED_BILLING_MODE",
			"This plan is not a monthly subscription",
			409,
		);
	if (!terms.stripePriceId || !terms.stripeAccountId)
		throw new ServiceError(
			"PLAN_NOT_PROVISIONED",
			"This plan is not ready to sell. Republish it.",
			409,
		);
	const stripePriceId = terms.stripePriceId;
	const stripeAccountId = terms.stripeAccountId;

	const readiness = await getPaymentReadiness(principal.creatorId);
	if (!readiness.canSell || readiness.stripeAccountId !== stripeAccountId)
		throw new ServiceError(
			"PAYMENTS_NOT_READY",
			"This creator cannot accept payments yet",
			409,
		);
	const account = await db.query.connectedAccounts.findFirst({
		where: and(
			eq(connectedAccounts.userId, principal.creatorId),
			eq(connectedAccounts.stripeAccountId, stripeAccountId),
			isNull(connectedAccounts.disconnectedAt),
		),
		columns: { livemode: true },
	});
	if (account?.livemode !== false)
		throw new ServiceError(
			"SUBSCRIPTIONS_SANDBOX_ONLY",
			"Monthly subscriptions are available in Stripe test mode only until the live-release gate is complete",
			409,
		);

	const user = await db.query.user.findFirst({
		where: eq(userTable.id, input.userId),
		columns: { id: true, email: true, name: true },
	});
	if (!user)
		throw new ServiceError("NOT_FOUND", "Customer account not found", 404);

	const customer = await ensureCreatorCustomer(
		{
			creatorId: principal.creatorId,
			userId: user.id,
			email: user.email,
			name: user.name,
			stripeAccountId,
		},
		adapter,
	);

	const state = await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([principal.creatorId, user.id, plan.id, "subscription"])}, 0))`,
		);
		let existing = await tx.query.subscriptions.findFirst({
			where: and(
				eq(subscriptions.creatorId, principal.creatorId),
				eq(subscriptions.userId, user.id),
				eq(subscriptions.planId, plan.id),
				inArray(subscriptions.status, [
					"pending",
					"incomplete",
					"active",
					"past_due",
				]),
			),
		});
		// A Checkout session expires after 24 hours. Allow a fresh attempt after a
		// safety margin if its `checkout.session.expired` webhook was missed; the
		// old Checkout can no longer create a second live Stripe subscription.
		if (
			existing?.status === "pending" &&
			existing.createdAt.getTime() < Date.now() - 25 * 60 * 60 * 1000
		) {
			await tx
				.update(subscriptions)
				.set({ status: "canceled" })
				.where(eq(subscriptions.id, existing.id));
			existing = undefined;
		}
		if (existing) {
			if (existing.status !== "pending" || existing.stripeSubscriptionId)
				throw new ServiceError(
					"SUBSCRIPTION_EXISTS",
					"A subscription for this plan is already being processed or is active",
					409,
				);
			return existing;
		}
		const subscriptionValues = {
			creatorId: principal.creatorId,
			userId: user.id,
			planId: plan.id,
			planVersionId: terms.id,
			stripeAccountId,
			stripeCustomerId: customer.stripeCustomerId as string,
			applicationFeePercent: PLATFORM_FEE_PERCENT * 100,
			status: "pending" as const,
		} satisfies typeof subscriptions.$inferInsert;
		const [created] = await tx
			.insert(subscriptions)
			.values(subscriptionValues)
			.returning();
		await tx
			.insert(enrollments)
			.values({
				creatorId: principal.creatorId,
				userId: user.id,
				planId: plan.id,
			})
			.onConflictDoNothing({
				target: [enrollments.userId, enrollments.planId],
			});
		return created;
	});

	let session: Awaited<
		ReturnType<typeof createDirectSubscriptionCheckoutSession>
	>;
	try {
		session = await adapter.createDirectSubscriptionCheckoutSession({
			stripeAccountId,
			lineItem: {
				name: plan.name,
				description: plan.description,
				unitAmount: terms.price,
				currency: terms.currency,
				stripePriceId,
			},
			applicationFeePercent: PLATFORM_FEE_PERCENT * 100,
			stripeCustomerId: customer.stripeCustomerId,
			customerEmail: user.email,
			successUrl: appUrl(
				`/dashboard?subscriptionSuccess=true&planId=${plan.id}`,
			),
			cancelUrl: appUrl("/dashboard?subscriptionCanceled=true"),
			metadata: {
				subscriptionId: state.id,
				creatorId: principal.creatorId,
				userId: user.id,
				planId: plan.id,
				planVersionId: terms.id,
				stripeAccountId,
			},
			idempotencyKey: `litesubs:subscription-checkout:${state.id}`,
		});
	} catch {
		// Keep the pending row: if Stripe created the session but its response was
		// lost, a retry with the same key must recover that exact Checkout.
		throw new ServiceError(
			"CHECKOUT_UNAVAILABLE",
			"Stripe could not start this subscription checkout",
			502,
		);
	}
	if (!session.url)
		throw new ServiceError(
			"CHECKOUT_UNAVAILABLE",
			"No checkout URL was returned",
			502,
		);
	await db
		.update(subscriptions)
		.set({ stripeCheckoutId: session.id })
		.where(eq(subscriptions.id, state.id));
	return { status: "checkout", paymentId: state.id, url: session.url };
}

/** Bind Checkout to the Stripe subscription without granting any credits. */
export async function attachStripeSubscription(input: {
	subscriptionId: string;
	checkoutSessionId: string;
	stripeSubscriptionId: string;
	stripeAccountId: string;
}) {
	const [updated] = await db
		.update(subscriptions)
		.set({
			stripeSubscriptionId: input.stripeSubscriptionId,
			status: "incomplete",
		})
		.where(
			and(
				eq(subscriptions.id, input.subscriptionId),
				eq(subscriptions.stripeCheckoutId, input.checkoutSessionId),
				eq(subscriptions.stripeAccountId, input.stripeAccountId),
				eq(subscriptions.status, "pending"),
			),
		)
		.returning();
	if (updated) return updated;

	const existing = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, input.subscriptionId),
	});
	if (
		existing?.stripeAccountId === input.stripeAccountId &&
		existing?.stripeCheckoutId === input.checkoutSessionId &&
		existing?.stripeSubscriptionId === input.stripeSubscriptionId
	)
		return existing;
	throw new ServiceError(
		"SUBSCRIPTION_MISMATCH",
		"Checkout does not match the expected subscription",
		409,
	);
}

export async function closeSubscriptionCheckout(checkoutSessionId: string) {
	await db
		.update(subscriptions)
		.set({ status: "canceled" })
		.where(
			and(
				eq(subscriptions.stripeCheckoutId, checkoutSessionId),
				eq(subscriptions.status, "pending"),
			),
		);
}

/**
 * Fulfil a paid subscription invoice exactly once. Metadata links can recover
 * the subscription if invoice.paid beats checkout.session.completed; account
 * scope, immutable plan version, and the invoice line's Price are validated by
 * the webhook before it calls this transaction.
 */
export async function fulfillSubscriptionInvoice(input: {
	subscriptionId: string;
	stripeSubscriptionId: string;
	stripeAccountId: string;
	stripeInvoiceId: string;
	billingReason: "subscription_create" | "subscription_cycle";
	amountPaid: number;
	currency: string;
	periodStart: Date;
	periodEnd: Date;
	paidAt: Date;
}): Promise<{ status: "fulfilled" | "already_fulfilled"; credits: number }> {
	if (
		input.billingReason !== "subscription_create" &&
		input.billingReason !== "subscription_cycle"
	)
		throw new ServiceError(
			"UNSUPPORTED_INVOICE",
			"This invoice does not represent a monthly billing period",
			409,
		);
	if (input.periodEnd <= input.periodStart || input.amountPaid < 0)
		throw new ServiceError("INVALID_INVOICE", "Invoice period is invalid", 400);
	return db.transaction(async (tx) => {
		const [subscription] = await tx
			.select()
			.from(subscriptions)
			.where(
				and(
					eq(subscriptions.id, input.subscriptionId),
					eq(subscriptions.stripeAccountId, input.stripeAccountId),
				),
			)
			.for("update");
		if (!subscription)
			throw new ServiceError("NOT_FOUND", "Subscription not found", 404);
		if (
			subscription.stripeSubscriptionId &&
			subscription.stripeSubscriptionId !== input.stripeSubscriptionId
		)
			throw new ServiceError(
				"SUBSCRIPTION_MISMATCH",
				"Invoice belongs to a different Stripe subscription",
				409,
			);

		const existing = await tx.query.subscriptionInvoices.findFirst({
			where: and(
				eq(subscriptionInvoices.stripeAccountId, input.stripeAccountId),
				eq(subscriptionInvoices.stripeInvoiceId, input.stripeInvoiceId),
			),
		});
		if (existing) {
			if (existing.subscriptionId !== subscription.id)
				throw new ServiceError(
					"INVOICE_SUBSCRIPTION_MISMATCH",
					"Invoice was already recorded for another subscription",
					409,
				);
			return {
				status: "already_fulfilled" as const,
				credits: existing.creditedAt
					? ((
							await tx.query.planVersions.findFirst({
								where: eq(planVersions.id, subscription.planVersionId),
								columns: { credits: true },
							})
						)?.credits ?? 0)
					: 0,
			};
		}
		const version = await tx.query.planVersions.findFirst({
			where: eq(planVersions.id, subscription.planVersionId),
		});
		if (version?.billingMode !== "recurring" || version.interval !== "month")
			throw new ServiceError(
				"INVALID_SUBSCRIPTION_TERMS",
				"Subscription does not reference a monthly plan version",
				409,
			);
		if (input.currency !== version.currency)
			throw new ServiceError(
				"INVOICE_CURRENCY_MISMATCH",
				"Invoice currency does not match the purchased plan",
				409,
			);
		const periodReceipt = await tx.query.subscriptionInvoices.findFirst({
			where: and(
				eq(subscriptionInvoices.subscriptionId, subscription.id),
				eq(subscriptionInvoices.periodStart, input.periodStart),
				eq(subscriptionInvoices.periodEnd, input.periodEnd),
			),
		});
		if (periodReceipt)
			return {
				status: "already_fulfilled" as const,
				credits: periodReceipt.creditedAt ? version.credits : 0,
			};

		const now = new Date();
		const startsAfterPaidBoundary =
			!subscription.paidThroughAt ||
			input.periodStart >= subscription.paidThroughAt;
		const advancesPaidBoundary =
			startsAfterPaidBoundary &&
			(!subscription.paidThroughAt ||
				input.periodEnd > subscription.paidThroughAt);
		const canGrant = advancesPaidBoundary && input.periodEnd > now;
		const [invoice] = await tx
			.insert(subscriptionInvoices)
			.values({
				subscriptionId: subscription.id,
				stripeAccountId: input.stripeAccountId,
				stripeInvoiceId: input.stripeInvoiceId,
				amountPaid: input.amountPaid,
				currency: version.currency,
				periodStart: input.periodStart,
				periodEnd: input.periodEnd,
				paidAt: input.paidAt,
				creditedAt: canGrant ? now : null,
			})
			.returning();
		if (!invoice)
			throw new ServiceError(
				"INVOICE_CONFLICT",
				"Invoice was already recorded",
				409,
			);

		const [enrollment] = await tx
			.insert(enrollments)
			.values({
				userId: subscription.userId,
				planId: subscription.planId,
				creatorId: subscription.creatorId,
			})
			.onConflictDoUpdate({
				target: [enrollments.userId, enrollments.planId],
				set: { updatedAt: now },
			})
			.returning();
		const balanceBefore = await usableBalance(tx, enrollment.id);
		await tx
			.update(enrollments)
			.set({ credits: balanceBefore })
			.where(eq(enrollments.id, enrollment.id));
		const [entry] = await tx
			.insert(transactions)
			.values({
				userId: subscription.userId,
				creatorId: subscription.creatorId,
				planId: subscription.planId,
				planVersionId: subscription.planVersionId,
				amount: canGrant ? version.credits : 0,
				amountMoney: input.amountPaid,
				currency: version.currency,
				type: "purchase",
				status: "completed",
				description: canGrant
					? `Monthly allowance: ${version.credits} credits`
					: "Paid monthly invoice; no credits granted (period expired or superseded)",
				stripeCheckoutId: null,
				usesStripeConnect: true,
				stripeApplicationFee: null,
				stripeConnectAccountId: input.stripeAccountId,
				balanceBefore,
				balanceAfter: canGrant
					? balanceBefore + version.credits
					: balanceBefore,
			})
			.returning({ id: transactions.id });

		if (canGrant) {
			await grantCredits(tx, {
				enrollmentId: enrollment.id,
				creatorId: subscription.creatorId,
				userId: subscription.userId,
				planId: subscription.planId,
				planVersionId: subscription.planVersionId,
				sourceTransactionId: entry.id,
				kind: "period",
				amount: version.credits,
				expiresAt: input.periodEnd,
			});
		}

		await tx
			.update(subscriptions)
			.set({
				stripeSubscriptionId: input.stripeSubscriptionId,
				...(advancesPaidBoundary
					? {
							status:
								subscription.status === "canceled" ? "canceled" : "active",
							paidThroughAt: input.periodEnd,
						}
					: {}),
			})
			.where(eq(subscriptions.id, subscription.id));
		return {
			status: "fulfilled" as const,
			credits: canGrant ? version.credits : 0,
		};
	});
}

/** Record an unpaid renewal state without changing the paid-through boundary. */
export async function markSubscriptionInvoiceFailed(input: {
	subscriptionId: string;
	stripeSubscriptionId: string;
	stripeAccountId: string;
	stripeInvoiceId: string;
	billingReason: "subscription_create" | "subscription_cycle";
	periodStart: Date;
	periodEnd: Date;
}): Promise<"past_due" | "incomplete" | "already_paid" | "stale"> {
	if (input.periodEnd <= input.periodStart)
		throw new ServiceError("INVALID_INVOICE", "Invoice period is invalid", 400);
	return db.transaction(async (tx) => {
		const [subscription] = await tx
			.select()
			.from(subscriptions)
			.where(
				and(
					eq(subscriptions.id, input.subscriptionId),
					eq(subscriptions.stripeAccountId, input.stripeAccountId),
				),
			)
			.for("update");
		if (!subscription)
			throw new ServiceError("NOT_FOUND", "Subscription not found", 404);
		if (
			subscription.stripeSubscriptionId &&
			subscription.stripeSubscriptionId !== input.stripeSubscriptionId
		)
			throw new ServiceError(
				"SUBSCRIPTION_MISMATCH",
				"Invoice belongs to a different Stripe subscription",
				409,
			);
		const paidInvoice = await tx.query.subscriptionInvoices.findFirst({
			where: and(
				eq(subscriptionInvoices.stripeAccountId, input.stripeAccountId),
				eq(subscriptionInvoices.stripeInvoiceId, input.stripeInvoiceId),
			),
			columns: { id: true },
		});
		if (paidInvoice) return "already_paid";
		if (subscription.status === "canceled") return "stale";
		if (
			subscription.paidThroughAt &&
			input.periodEnd <= subscription.paidThroughAt
		)
			return "stale";

		const status =
			input.billingReason === "subscription_create" ? "incomplete" : "past_due";
		await tx
			.update(subscriptions)
			.set({ stripeSubscriptionId: input.stripeSubscriptionId, status })
			.where(eq(subscriptions.id, subscription.id));
		return status;
	});
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

		// A purchase is a grant, so it is spendable, attributable to its version,
		// and expirable by the same engine as every other credit movement.
		const [entry] = await tx
			.insert(transactions)
			.values({
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
				balanceAfter: enrollment.credits + claimed.credits,
			})
			.returning({ id: transactions.id });

		await grantCredits(tx, {
			enrollmentId: enrollment.id,
			creatorId: claimed.creatorId,
			userId: claimed.userId,
			planId: claimed.planId,
			planVersionId: claimed.planVersionId,
			sourceTransactionId: entry.id,
			kind: "purchase",
			amount: claimed.credits,
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
