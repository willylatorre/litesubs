/**
 * Monthly subscription fulfillment is exercised through the real services and
 * PostgreSQL transaction boundary. Only Stripe's HTTP adapter is substituted;
 * the contract under test is one pending subscription, followed by one paid,
 * period-bound grant even when invoice and Checkout events arrive out of order.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable, migrated PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	creatorCustomers,
	creditGrants,
	enrollments,
	subscriptionInvoices,
	subscriptions,
	transactions,
	user,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { usableBalance } from "@/lib/services/credits";
import { getCustomer, listCustomers } from "@/lib/services/customers";
import { createPlan, updatePlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import { publishPlan } from "@/lib/services/publish";
import {
	attachStripeSubscription,
	fulfillSubscriptionInvoice,
	markSubscriptionInvoiceFailed,
	type SubscriptionStripeAdapter,
	startSubscription,
} from "@/lib/services/purchase";
import type { PlanOfferAdapter } from "@/lib/stripe-offers";
import { isSubscriptionOverdue } from "@/lib/subscription-state";

test("monthly renewals grant paid periods once and failed/late invoices do not extend access", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);
	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
	]);
	await db.insert(connectedAccounts).values({
		userId: creatorId,
		stripeAccountId: `acct_${creatorId}`,
		onboardingMode: "connected",
		authorizedViaOauth: true,
		livemode: false,
		status: "active",
		controllerType: "account",
		dashboardType: "full",
		feesPayer: "account",
		lossesPayments: "stripe",
		chargesEnabled: true,
		payoutsEnabled: true,
		cardPaymentsStatus: "active",
		detailsSubmitted: true,
		requirementsCurrentlyDue: [],
	});
	await db.insert(creatorCustomers).values({
		creatorId,
		userId: buyerId,
		stripeAccountId: `acct_${creatorId}`,
		stripeCustomerId: `cus_${buyerId}`,
		status: "ready",
		email: `${buyerId}@example.test`,
	});

	const planAdapter: PlanOfferAdapter = {
		createProduct: async (input) => ({ id: `prod_${input.versionId}` }),
		createPrice: async (input) => {
			assert.equal(input.interval, "month");
			return { id: `price_${input.versionId}` };
		},
		deactivateProduct: async () => {},
		deactivatePrice: async () => {},
	};
	const plan = await createPlan(creator, {
		name: "Monthly sessions",
		terms: {
			billingMode: "recurring",
			interval: "month",
			currency: "usd",
			price: 20,
			credits: 12,
		},
	});
	const firstVersionId = plan.terms?.id;
	assert.ok(firstVersionId);
	await publishPlan(creator, { plan: plan.id }, planAdapter);

	const idempotentSessions = new Map<string, { id: string; url: string }>();
	const checkoutInputs: Parameters<
		SubscriptionStripeAdapter["createDirectSubscriptionCheckoutSession"]
	>[0][] = [];
	const adapter: SubscriptionStripeAdapter = {
		createConnectedCustomer: async () => ({ id: `cus_${buyerId}` }),
		async createDirectSubscriptionCheckoutSession(input) {
			const key = input.idempotencyKey as string;
			const existing = idempotentSessions.get(key);
			if (existing) return existing as never;
			const session = {
				id: `cs_${creatorId}`,
				url: `https://checkout.stripe.test/${creatorId}`,
			};
			checkoutInputs.push(input);
			idempotentSessions.set(key, session);
			return session as never;
		},
	};

	// A real connected account marked live must never open this incomplete slice.
	await db
		.update(connectedAccounts)
		.set({ livemode: true })
		.where(eq(connectedAccounts.userId, creatorId));
	await assert.rejects(
		startSubscription(creator, { planId: plan.id, userId: buyerId }, adapter),
		{ code: "SUBSCRIPTIONS_SANDBOX_ONLY" },
	);
	await db
		.update(connectedAccounts)
		.set({ livemode: false })
		.where(eq(connectedAccounts.userId, creatorId));

	const starts = await Promise.all(
		Array.from({ length: 3 }, () =>
			startSubscription(creator, { planId: plan.id, userId: buyerId }, adapter),
		),
	);
	assert.ok(starts.every((result) => result.paymentId === starts[0].paymentId));
	assert.ok(starts.every((result) => result.url === starts[0].url));
	assert.equal(
		checkoutInputs.length,
		1,
		"Stripe idempotency reuses one Checkout",
	);
	assert.equal(checkoutInputs[0].applicationFeePercent, 2);
	assert.equal(
		checkoutInputs[0].lineItem.stripePriceId,
		`price_${firstVersionId}`,
	);
	const subscriptionId = starts[0].paymentId as string;
	const localSubscription = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, subscriptionId),
	});
	assert.equal(localSubscription?.status, "pending");
	assert.equal(localSubscription?.applicationFeePercent, 2);
	const enrollmentBeforePayment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, buyerId),
			eq(enrollments.planId, plan.id),
		),
	});
	assert.equal(enrollmentBeforePayment?.credits, 0);
	assert.equal(
		await db.query.creditGrants.findFirst({
			where: eq(creditGrants.planId, plan.id),
		}),
		undefined,
		"Checkout completion cannot itself grant credits",
	);

	const periodStart = new Date(Date.now() - 60_000);
	const periodEnd = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);
	const invoiceInput = {
		subscriptionId,
		stripeSubscriptionId: `sub_${creatorId}`,
		stripeAccountId: `acct_${creatorId}`,
		stripeInvoiceId: `in_${creatorId}`,
		billingReason: "subscription_create" as const,
		amountPaid: 0,
		currency: "usd",
		periodStart,
		periodEnd,
		paidAt: new Date(),
	};

	// invoice.paid is allowed to win the race with checkout.session.completed.
	const fulfilled = await Promise.all([
		fulfillSubscriptionInvoice(invoiceInput),
		fulfillSubscriptionInvoice(invoiceInput),
	]);
	assert.equal(
		fulfilled.filter((result) => result.status === "fulfilled").length,
		1,
	);
	assert.equal(
		fulfilled.filter((result) => result.status === "already_fulfilled").length,
		1,
	);
	await attachStripeSubscription({
		subscriptionId,
		checkoutSessionId: `cs_${creatorId}`,
		stripeSubscriptionId: `sub_${creatorId}`,
		stripeAccountId: `acct_${creatorId}`,
	});

	const enrollment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, buyerId),
			eq(enrollments.planId, plan.id),
		),
	});
	assert.equal(enrollment?.credits, 12);
	const grants = await db.query.creditGrants.findMany({
		where: eq(creditGrants.planId, plan.id),
	});
	assert.equal(grants.length, 1);
	assert.equal(grants[0].kind, "period");
	assert.equal(grants[0].amount, 12);
	assert.equal(grants[0].expiresAt?.getTime(), periodEnd.getTime());
	const receipts = await db.query.subscriptionInvoices.findMany({
		where: eq(subscriptionInvoices.subscriptionId, subscriptionId),
	});
	assert.equal(receipts.length, 1);
	assert.equal(receipts[0].amountPaid, 0);
	assert.ok(receipts[0].creditedAt);
	const ledger = await db.query.transactions.findMany({
		where: and(
			eq(transactions.planId, plan.id),
			eq(transactions.type, "purchase"),
		),
	});
	assert.equal(ledger.length, 1);
	const finalSubscription = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, subscriptionId),
	});
	assert.equal(finalSubscription?.status, "active");
	assert.equal(
		finalSubscription?.paidThroughAt?.getTime(),
		periodEnd.getTime(),
	);
	await updatePlan(creator, plan.id, {
		terms: {
			billingMode: "recurring",
			interval: "month",
			currency: "usd",
			price: 30,
			credits: 99,
		},
	});
	await publishPlan(creator, { plan: plan.id }, planAdapter);

	const renewalStart = periodEnd;
	const renewalEnd = new Date(periodEnd.getTime() + 28 * 24 * 60 * 60 * 1000);
	const renewal = {
		...invoiceInput,
		stripeInvoiceId: `in_renewal_${creatorId}`,
		billingReason: "subscription_cycle" as const,
		amountPaid: 2000,
		periodStart: renewalStart,
		periodEnd: renewalEnd,
		paidAt: new Date(),
	};
	const failedState = await markSubscriptionInvoiceFailed({
		subscriptionId,
		stripeSubscriptionId: renewal.stripeSubscriptionId,
		stripeAccountId: renewal.stripeAccountId,
		stripeInvoiceId: renewal.stripeInvoiceId,
		billingReason: renewal.billingReason,
		periodStart: renewal.periodStart,
		periodEnd: renewal.periodEnd,
	});
	assert.equal(failedState, "past_due");
	const overdue = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, subscriptionId),
	});
	assert.equal(overdue?.status, "past_due");
	assert.equal(overdue?.paidThroughAt?.getTime(), periodEnd.getTime());
	assert.equal(
		isSubscriptionOverdue(
			overdue?.status ?? "active",
			overdue?.paidThroughAt ?? null,
		),
		true,
	);
	assert.equal(await usableBalance(db, enrollment?.id as string), 12);

	const retried = await Promise.all([
		fulfillSubscriptionInvoice(renewal),
		fulfillSubscriptionInvoice(renewal),
	]);
	assert.equal(
		retried.filter((result) => result.status === "fulfilled").length,
		1,
	);
	assert.equal(
		retried.filter((result) => result.status === "already_fulfilled").length,
		1,
	);
	assert.equal(
		await markSubscriptionInvoiceFailed({
			subscriptionId,
			stripeSubscriptionId: renewal.stripeSubscriptionId,
			stripeAccountId: renewal.stripeAccountId,
			stripeInvoiceId: renewal.stripeInvoiceId,
			billingReason: renewal.billingReason,
			periodStart: renewal.periodStart,
			periodEnd: renewal.periodEnd,
		}),
		"already_paid",
	);

	// An older, delayed invoice is recorded financially but cannot reopen a
	// period or overwrite the newer paid-through boundary.
	const outOfOrder = await fulfillSubscriptionInvoice({
		...renewal,
		stripeInvoiceId: `in_old_${creatorId}`,
		amountPaid: 2000,
		periodStart: new Date(periodEnd.getTime() + 1000),
		periodEnd: new Date(periodEnd.getTime() + 14 * 24 * 60 * 60 * 1000),
		paidAt: new Date(),
	});
	assert.equal(outOfOrder.status, "fulfilled");
	assert.equal(outOfOrder.credits, 0);
	const latePeriod = await fulfillSubscriptionInvoice({
		...renewal,
		stripeInvoiceId: `in_late_${creatorId}`,
		periodStart: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
		periodEnd: new Date(Date.now() - 32 * 24 * 60 * 60 * 1000),
		paidAt: new Date(),
	});
	assert.equal(latePeriod.credits, 0);
	const finalBalance = await usableBalance(db, enrollment?.id as string);
	assert.equal(finalBalance, 24);
	const latestSubscription = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, subscriptionId),
	});
	assert.equal(latestSubscription?.status, "active");
	assert.equal(
		latestSubscription?.paidThroughAt?.getTime(),
		renewalEnd.getTime(),
	);
	assert.equal(
		isSubscriptionOverdue(
			latestSubscription?.status ?? "pending",
			latestSubscription?.paidThroughAt ?? null,
		),
		false,
	);
	const allGrants = await db.query.creditGrants.findMany({
		where: eq(creditGrants.planId, plan.id),
	});
	assert.equal(allGrants.length, 2);
	assert.ok(allGrants.every((grant) => grant.amount === 12));
	const allReceipts = await db.query.subscriptionInvoices.findMany({
		where: eq(subscriptionInvoices.subscriptionId, subscriptionId),
	});
	assert.equal(allReceipts.length, 4);
	assert.equal(allReceipts.filter((receipt) => receipt.creditedAt).length, 2);
	const allLedger = await db.query.transactions.findMany({
		where: and(
			eq(transactions.planId, plan.id),
			eq(transactions.type, "purchase"),
		),
	});
	assert.equal(allLedger.length, 4);
	assert.equal(allLedger.filter((row) => row.amount === 0).length, 2);
	assert.ok(allLedger.every((row) => row.planVersionId === firstVersionId));
	assert.equal(
		allLedger.reduce((total, row) => total + (row.amountMoney ?? 0), 0),
		6000,
	);

	// A delayed lifecycle event cannot make expired units look spendable: API
	// summaries derive balance and overdue from grant expiry and paid-through.
	const expiredAt = new Date(Date.now() - 1000);
	await db
		.update(creditGrants)
		.set({ expiresAt: expiredAt })
		.where(eq(creditGrants.planId, plan.id));
	await db
		.update(subscriptions)
		.set({ paidThroughAt: expiredAt, status: "active" })
		.where(eq(subscriptions.id, subscriptionId));
	const [creatorSummary] = await listCustomers(creator);
	assert.equal(creatorSummary.credits, 0);
	assert.equal(creatorSummary.enrollments[0].credits, 0);
	assert.ok(creatorSummary.enrollments[0].billingSubscription);
	assert.equal(creatorSummary.enrollments[0].billingSubscription.overdue, true);
	const apiCustomer = await getCustomer(creator, buyerId);
	assert.equal(apiCustomer.enrollments[0].credits, 0);
	assert.ok(apiCustomer.enrollments[0].billingSubscription);
	assert.equal(apiCustomer.enrollments[0].billingSubscription.overdue, true);

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, buyerId));
});
