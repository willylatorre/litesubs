/**
 * The money path under real concurrency.
 *
 * Every other purchase test calls a service twice and checks the second call
 * said "already done". That is a *sequential* replay, and it proves nothing about
 * the case that actually double-credits a customer: two deliveries that both
 * read "not yet granted" before either commits. This suite starts N writers at
 * once, against a real PostgreSQL, so the assertion is about the database's
 * serialization (a locked row or a unique constraint) rather than about the order
 * a single caller happened to run in.
 *
 * The pool opens up to ten connections, so `Promise.all` here really is parallel
 * and not one transaction queued behind another on a single client.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database. The
 * unique-grant case needs the `0024_ledger_integrity` migration applied.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	creditAllocations,
	creditGrants,
	enrollments,
	payments,
	planVersions,
	subscriptionInvoices,
	subscriptions,
	transactions,
	user,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import {
	createGrant,
	grantCredits,
	usableBalance,
} from "@/lib/services/credits";
import { createPlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import { publishPlan } from "@/lib/services/publish";
import {
	fulfillPayment,
	fulfillSubscriptionInvoice,
	startPurchase,
} from "@/lib/services/purchase";
import type { PlanOfferAdapter } from "@/lib/stripe-offers";
import { grantTestPremium } from "@/lib/test-premium";

const CONCURRENCY = 8;

const offerAdapter: PlanOfferAdapter = {
	createProduct: async () => ({ id: "prod_t066" }),
	createPrice: async () => ({ id: "price_t066" }),
	deactivateProduct: async () => {},
	deactivatePrice: async () => {},
};

/** Stripe's only role here is to hand back ids; nothing HTTP is exercised. */
function stubCheckout() {
	let seq = 0;
	return {
		async createConnectedCustomer(input: {
			stripeAccountId: string;
			email: string;
		}) {
			return { id: `cus_${input.stripeAccountId}_${input.email}` };
		},
		async createDirectCheckoutSession() {
			// Session ids are globally unique, so the stub must not restart per call.
			seq += 1;
			return {
				id: `cs_t066_${process.pid}_${Date.now()}_${seq}`,
				url: `https://checkout.stripe.test/${seq}`,
			} as never;
		},
	};
}

async function fixture(label: string) {
	const creatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	await db.insert(user).values([
		{
			id: creatorId,
			name: `Creator ${label}`,
			email: `${creatorId}@example.test`,
		},
		{ id: buyerId, name: `Buyer ${label}`, email: `${buyerId}@example.test` },
	]);
	await grantTestPremium(creatorId);
	// Unique per invocation: a fixed label collides on the account's own unique
	// index when a previous run left rows behind after a failure.
	const stripeAccountId = `acct_t066_${label}_${crypto.randomUUID().slice(0, 8)}`;
	await db.insert(connectedAccounts).values({
		userId: creatorId,
		stripeAccountId,
		onboardingMode: "connected",
		authorizedViaOauth: true,
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
	const creator = sessionPrincipal(creatorId);
	const plan = await createPlan(creator, {
		name: `Concurrency ${label}`,
		terms: {
			billingMode: "one_time",
			currency: "usd",
			price: 10,
			credits: 10,
		},
	});
	await publishPlan(creator, { plan: plan.id }, offerAdapter);
	return { creatorId, buyerId, creator, plan, stripeAccountId };
}

async function cleanup(...ids: string[]) {
	for (const id of ids) await db.delete(user).where(eq(user.id, id));
}

/**
 * Assert a database rejection by the sentence Postgres raised, not by Drizzle's
 * wrapper.
 *
 * Drizzle 0.45 rethrows driver errors as `DrizzleQueryError` whose message is
 * only `Failed query: …`; the real text lives on `cause`. `assert.rejects` with
 * a RegExp tests the outer message, so it would never see it.
 */
async function rejectsWith(action: Promise<unknown>, pattern: RegExp) {
	let caught: unknown;
	try {
		await action;
	} catch (error) {
		caught = error;
	}
	assert.ok(caught, `expected a rejection matching ${pattern}`);
	const messages: string[] = [];
	let current: unknown = caught;
	for (let depth = 0; depth < 4 && current; depth += 1) {
		const candidate = current as { message?: string; cause?: unknown };
		if (candidate.message) messages.push(candidate.message);
		current = candidate.cause;
	}
	assert.match(messages.join(" | "), pattern);
}

/**
 * Assert a query found a row, returning it narrowed.
 *
 * Avoids the non-null assertion the rest of this suite would otherwise need at
 * nine sites; the whole repository uses none, and the lint rules warn on them.
 */
function found<T>(value: T | undefined | null, what: string): T {
	assert.ok(value, `expected ${what} to exist`);
	return value;
}

test("concurrent duplicate delivery of one checkout grants exactly once", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const f = await fixture("dupe");
	const started = await startPurchase(
		f.creator,
		{ planId: f.plan.id, userId: f.buyerId },
		stubCheckout(),
	);
	const pending = await db.query.payments.findFirst({
		where: eq(payments.id, started.paymentId as string),
	});
	assert.ok(pending?.stripeCheckoutId);

	// Every writer starts from `pending`, so all of them race for the claim. A
	// read-before-transaction check would let several through; the conditional
	// UPDATE + row lock must let exactly one win.
	const results = await Promise.all(
		Array.from({ length: CONCURRENCY }, () =>
			fulfillPayment({
				checkoutSessionId: pending.stripeCheckoutId as string,
				amountPaid: 1000,
			}),
		),
	);
	const fulfilled = results.filter((r) => r.status === "fulfilled");
	assert.equal(fulfilled.length, 1, "exactly one delivery may grant");

	const grants = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.creatorId, f.creatorId));
	const ledger = await db
		.select()
		.from(transactions)
		.where(eq(transactions.creatorId, f.creatorId));
	const enrollment = found(
		await db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.userId, f.buyerId),
				eq(enrollments.planId, f.plan.id),
			),
		}),
		"enrollment",
	);
	assert.equal(grants.length, 1, "one grant for one payment");
	assert.equal(ledger.length, 1, "one ledger row for one payment");
	assert.equal(await usableBalance(db, enrollment.id), 10);
	// The projection must agree with the grants, not carry a second adding.
	assert.equal(enrollment.credits, 10);

	await cleanup(f.creatorId, f.buyerId);
});

test("concurrent delivery of different checkouts grants each exactly once", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const f = await fixture("distinct");
	const adapter = stubCheckout();
	// Ten distinct paid sessions for the same buyer, then fulfil all at once.
	const sessionIds: string[] = [];
	for (let i = 0; i < CONCURRENCY; i += 1) {
		const started = await startPurchase(
			f.creator,
			{ planId: f.plan.id, userId: f.buyerId },
			adapter,
		);
		const row = found(
			await db.query.payments.findFirst({
				where: eq(payments.id, started.paymentId as string),
			}),
			"payment",
		);
		sessionIds.push(found(row.stripeCheckoutId, "checkout session id"));
	}

	await Promise.all(
		sessionIds.map((checkoutSessionId) =>
			fulfillPayment({ checkoutSessionId, amountPaid: 1000 }),
		),
	);

	const grants = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.creatorId, f.creatorId));
	const enrollment = found(
		await db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.userId, f.buyerId),
				eq(enrollments.planId, f.plan.id),
			),
		}),
		"enrollment",
	);
	assert.equal(grants.length, CONCURRENCY, "one grant per distinct payment");
	assert.equal(await usableBalance(db, enrollment.id), CONCURRENCY * 10);
	assert.equal(enrollment.credits, CONCURRENCY * 10);

	await cleanup(f.creatorId, f.buyerId);
});

test("one ledger row can never produce two grants, even when writers bypass the service", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const f = await fixture("unique");
	try {
		const [enrollment] = await db
			.insert(enrollments)
			.values({ creatorId: f.creatorId, userId: f.buyerId, planId: f.plan.id })
			.returning();
		const [entry] = await db
			.insert(transactions)
			.values({
				creatorId: f.creatorId,
				userId: f.buyerId,
				planId: f.plan.id,
				amount: 10,
				type: "purchase",
				status: "completed",
			})
			.returning({ id: transactions.id });

		// This is the raw insert every fulfilment path performs. The constraint, not
		// the caller, is what stops the second one.
		const attempts = await Promise.all(
			Array.from({ length: CONCURRENCY }, () =>
				db.transaction((tx) =>
					createGrant(tx, {
						enrollmentId: enrollment.id,
						creatorId: f.creatorId,
						userId: f.buyerId,
						planId: f.plan.id,
						sourceTransactionId: entry.id,
						kind: "purchase",
						amount: 10,
					}),
				),
			),
		);
		assert.equal(
			attempts.filter((r) => !r.duplicate).length,
			1,
			"exactly one inserter may create the grant",
		);
		const grants = await db
			.select()
			.from(creditGrants)
			.where(eq(creditGrants.sourceTransactionId, entry.id));
		assert.equal(grants.length, 1);
	} finally {
		// Always clean up: a failed assertion here is exactly the mutated scenario,
		// and leftover duplicate grants would make the next migration fail to apply
		// its unique index — a confusing second failure far from its cause.
		await cleanup(f.creatorId, f.buyerId);
	}
});

test("a failed delivery leaves no grant and a retry still grants once", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const f = await fixture("retry");
	const started = await startPurchase(
		f.creator,
		{ planId: f.plan.id, userId: f.buyerId },
		stubCheckout(),
	);
	const pending = found(
		await db.query.payments.findFirst({
			where: eq(payments.id, started.paymentId as string),
		}),
		"payment",
	);
	const checkoutSessionId = found(
		pending.stripeCheckoutId,
		"checkout session id",
	);

	// Force the write itself to fail *after* the payment claim: pre-claim the
	// ledger's unique `stripe_checkout_id` with an unrelated row, so the
	// fulfilment's own insert violates it. The whole transaction must roll back —
	// no half-debit, no orphan grant — and the payment must stay pending so
	// Stripe's retry can succeed.
	const [squatter] = await db
		.insert(transactions)
		.values({
			creatorId: f.creatorId,
			userId: f.buyerId,
			planId: f.plan.id,
			amount: 0,
			type: "manual_adjustment",
			status: "completed",
			description: "test squatter holding the checkout id",
			stripeCheckoutId: checkoutSessionId,
		})
		.returning({ id: transactions.id });
	await rejectsWith(
		fulfillPayment({ checkoutSessionId, amountPaid: 1000 }),
		/transactions_stripe_checkout_id_unique/,
	);

	const afterFailure = await db.query.payments.findFirst({
		where: eq(payments.id, started.paymentId as string),
	});
	assert.equal(afterFailure?.status, "pending", "the claim rolled back");
	const grantsAfterFailure = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.creatorId, f.creatorId));
	const ledgerAfterFailure = await db
		.select()
		.from(transactions)
		.where(
			and(
				eq(transactions.creatorId, f.creatorId),
				eq(transactions.type, "purchase"),
			),
		);
	assert.equal(grantsAfterFailure.length, 0, "no orphan grant");
	assert.equal(ledgerAfterFailure.length, 0, "no orphan ledger row");
	// Delete the squatter directly: it is a constraint fixture, not history, and
	// the append-only trigger guards UPDATE, not DELETE (a cascade needs DELETE).
	await db.delete(transactions).where(eq(transactions.id, squatter.id));

	// Retry: a failed-then-retried delivery grants once.
	const retried = await fulfillPayment({ checkoutSessionId, amountPaid: 1000 });
	assert.equal(retried.status, "fulfilled");
	const grantsAfterRetry = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.creatorId, f.creatorId));
	assert.equal(grantsAfterRetry.length, 1, "the retry granted exactly once");

	const enrollment = found(
		await db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.userId, f.buyerId),
				eq(enrollments.planId, f.plan.id),
			),
		}),
		"enrollment",
	);
	assert.equal(await usableBalance(db, enrollment.id), 10);

	await cleanup(f.creatorId, f.buyerId);
});

test("concurrent duplicate delivery of one paid invoice grants exactly once", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const f = await fixture("invoice");
	const creator = sessionPrincipal(f.creatorId);
	const plan = await createPlan(creator, {
		name: `Monthly ${crypto.randomUUID().slice(0, 8)}`,
		terms: {
			billingMode: "recurring",
			interval: "month",
			currency: "usd",
			price: 1000,
			credits: 10,
		},
	});
	await publishPlan(creator, { plan: plan.id }, offerAdapter);
	const version = found(
		await db.query.planVersions.findFirst({
			where: and(
				eq(planVersions.planId, plan.id),
				eq(planVersions.status, "published"),
			),
		}),
		"published plan version",
	);
	const [subscription] = await db
		.insert(subscriptions)
		.values({
			creatorId: f.creatorId,
			userId: f.buyerId,
			planId: plan.id,
			planVersionId: version.id,
			stripeAccountId: f.stripeAccountId,
			stripeCustomerId: `cus_${f.buyerId}`,
			stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
			status: "incomplete",
		})
		.returning();

	const periodStart = new Date(Date.now() + 60_000);
	const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 3600_000);
	const results = await Promise.all(
		Array.from({ length: CONCURRENCY }, () =>
			fulfillSubscriptionInvoice({
				subscriptionId: subscription.id,
				stripeSubscriptionId: subscription.stripeSubscriptionId as string,
				stripeAccountId: f.stripeAccountId,
				stripeInvoiceId: `in_${subscription.id}`,
				billingReason: "subscription_create",
				amountPaid: 1000,
				currency: "usd",
				periodStart,
				periodEnd,
				paidAt: new Date(),
			}),
		),
	);
	assert.equal(
		results.filter((r) => r.status === "fulfilled").length,
		1,
		"one delivery fulfils the invoice",
	);

	const invoices = await db
		.select()
		.from(subscriptionInvoices)
		.where(eq(subscriptionInvoices.subscriptionId, subscription.id));
	const grants = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.creatorId, f.creatorId));
	assert.equal(invoices.length, 1, "one receipt for one invoice");
	assert.equal(grants.length, 1, "one allowance for one invoice");

	await cleanup(f.creatorId, f.buyerId);
});

test("the operation audit refuses an in-place rewrite", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const f = await fixture("audit");
	const [enrollment] = await db
		.insert(enrollments)
		.values({ creatorId: f.creatorId, userId: f.buyerId, planId: f.plan.id })
		.returning();
	const [entry] = await db
		.insert(transactions)
		.values({
			creatorId: f.creatorId,
			userId: f.buyerId,
			planId: f.plan.id,
			amount: 10,
			type: "manual_adjustment",
			status: "completed",
		})
		.returning({ id: transactions.id });
	await db.transaction((tx) =>
		grantCredits(tx, {
			enrollmentId: enrollment.id,
			creatorId: f.creatorId,
			userId: f.buyerId,
			planId: f.plan.id,
			sourceTransactionId: entry.id,
			kind: "adjustment",
			amount: 10,
		}),
	);
	const grant = found(
		await db.query.creditGrants.findFirst({
			where: eq(creditGrants.sourceTransactionId, entry.id),
		}),
		"grant",
	);
	const [allocation] = await db
		.insert(creditAllocations)
		.values({
			transactionId: entry.id,
			grantId: grant.id,
			creatorId: f.creatorId,
			amount: 1,
		})
		.returning();

	// The ledger row is history: changing what happened must fail, and the row
	// must be unchanged afterwards.
	await rejectsWith(
		db
			.update(transactions)
			.set({ amount: 999 })
			.where(eq(transactions.id, entry.id)),
		/append-only/,
	);
	const reread = await db.query.transactions.findFirst({
		where: eq(transactions.id, entry.id),
	});
	assert.equal(reread?.amount, 10);

	// Likewise an allocation cannot be repointed or resized.
	await rejectsWith(
		db
			.update(creditAllocations)
			.set({ amount: 5 })
			.where(eq(creditAllocations.id, allocation.id)),
		/append-only/,
	);

	await cleanup(f.creatorId, f.buyerId);
});
