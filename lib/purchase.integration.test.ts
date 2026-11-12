/**
 * Purchase is where money and credits meet, so these tests target the failures
 * that cost real money: granting twice, granting without payment, charging the
 * wrong account, and handing one buyer's identity to another.
 *
 * Real service and database; only the Stripe adapter is stubbed, because the
 * assertions are about local state transitions and authorization, not Stripe's
 * HTTP behaviour.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	creatorCustomers,
	enrollments,
	payments,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { createPlan, updatePlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import { publishPlan } from "@/lib/services/publish";
import {
	closePayment,
	fulfillPayment,
	issueCheckoutToken,
	type PurchaseStripeAdapter,
	redeemCheckoutToken,
	startPurchase,
} from "@/lib/services/purchase";
import type { PlanOfferAdapter } from "@/lib/stripe-offers";

/**
 * Substitute the two Stripe entry points purchase uses. `customers` and
 * `sessions` record what would have been created so assertions can prove
 * reuse and account scoping.
 */
// Stripe session ids are globally unique, so the stub's counter must be too:
// restarting it per stub would collide on payments.stripe_checkout_id.
let stubSessionSeq = 0;

function stubStripe(options?: {
	failCustomer?: boolean;
	failSession?: boolean;
}) {
	const created = { customers: [] as string[], sessions: [] as string[] };
	let customerSeq = 0;
	const adapter: PurchaseStripeAdapter = {
		async createConnectedCustomer(input) {
			if (options?.failCustomer) throw new Error("simulated customer failure");
			customerSeq += 1;
			created.customers.push(`${input.stripeAccountId}:${input.email}`);
			return { id: `cus_${input.stripeAccountId}_${customerSeq}` };
		},
		async createDirectCheckoutSession(input) {
			if (options?.failSession) throw new Error("simulated session failure");
			stubSessionSeq += 1;
			created.sessions.push(input.stripeAccountId);
			return {
				id: `cs_test_${stubSessionSeq}`,
				url: `https://checkout.stripe.test/${stubSessionSeq}`,
				// The frozen price must be what gets charged, not a recomputed amount.
				priceId: input.lineItem.stripePriceId,
				customerId: input.stripeCustomerId,
			} as never;
		},
	};
	return { created, adapter };
}

test("purchase charges the creator's account once and grants only after payment", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: otherId, name: "Other", email: `${otherId}@example.test` },
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
	]);
	await db.insert(connectedAccounts).values({
		userId: creatorId,
		stripeAccountId: "acct_seller",
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

	const offerAdapter: PlanOfferAdapter = {
		createProduct: async () => ({ id: "prod_offer" }),
		createPrice: async () => ({ id: "price_offer" }),
		deactivateProduct: async () => {},
		deactivatePrice: async () => {},
	};
	const plan = await createPlan(creator, {
		name: "Sessions",
		terms: { billingMode: "one_time", currency: "usd", price: 10, credits: 10 },
	});
	await publishPlan(creator, { plan: plan.id }, offerAdapter);

	const balance = async () => {
		const row = await db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.userId, buyerId),
				eq(enrollments.planId, plan.id),
			),
		});
		return row?.credits ?? 0;
	};

	await t.test(
		"a purchase creates a receipt but grants nothing yet",
		async () => {
			const stripe = stubStripe();
			const result = await startPurchase(
				creator,
				{ planId: plan.id, userId: buyerId },
				stripe.adapter,
			);
			assert.equal(result.status, "checkout");
			assert.ok(result.url?.startsWith("https://checkout.stripe.test/"));
			assert.equal(
				await balance(),
				0,
				"unpaid checkout must not grant credits",
			);

			const payment = await db.query.payments.findFirst({
				where: eq(payments.id, result.paymentId as string),
			});
			assert.ok(payment);
			assert.equal(payment.status, "pending");
			assert.equal(payment.amountTotal, 1000);
			// 2% of $10.
			assert.equal(payment.applicationFee, 20);
			assert.equal(payment.stripeAccountId, "acct_seller");
			// The receipt is bound to the immutable version that was sold.
			const version = await db.query.planVersions.findFirst({
				where: eq(planVersions.id, payment.planVersionId),
			});
			assert.equal(version?.status, "published");
		},
	);

	await t.test(
		"fulfilling once grants the credits and records a receipt",
		async () => {
			const pending = await db.query.payments.findFirst({
				where: and(
					eq(payments.planId, plan.id),
					eq(payments.status, "pending"),
				),
			});
			assert.ok(pending?.stripeCheckoutId);
			const result = await fulfillPayment({
				checkoutSessionId: pending.stripeCheckoutId,
				amountPaid: 1000,
			});
			assert.equal(result.status, "fulfilled");
			assert.equal(result.credits, 10);
			assert.equal(await balance(), 10);

			const grant = await db.query.transactions.findFirst({
				where: eq(transactions.stripeCheckoutId, pending.stripeCheckoutId),
			});
			assert.equal(grant?.type, "purchase");
			assert.equal(grant?.status, "completed");
			assert.equal(grant?.amount, 10);
			assert.equal(grant?.stripeConnectAccountId, "acct_seller");
			assert.equal(grant?.planVersionId, pending.planVersionId);
		},
	);

	await t.test(
		"duplicate and concurrent deliveries grant exactly once",
		async () => {
			const paid = await db.query.payments.findFirst({
				where: and(eq(payments.planId, plan.id), eq(payments.status, "paid")),
			});
			assert.ok(paid?.stripeCheckoutId);

			const results = await Promise.all([
				fulfillPayment({
					checkoutSessionId: paid.stripeCheckoutId,
					amountPaid: 1000,
				}),
				fulfillPayment({
					checkoutSessionId: paid.stripeCheckoutId,
					amountPaid: 1000,
				}),
				fulfillPayment({
					checkoutSessionId: paid.stripeCheckoutId,
					amountPaid: 1000,
				}),
			]);
			assert.ok(results.every((r) => r.status === "already_fulfilled"));
			// The original purchase still holds exactly one grant of 10.
			assert.equal(await balance(), 10);
			const grants = await db
				.select()
				.from(transactions)
				.where(eq(transactions.stripeCheckoutId, paid.stripeCheckoutId));
			assert.equal(grants.length, 1);
		},
	);

	await t.test(
		"rebuying grants again without a second Stripe Customer",
		async () => {
			const before = await db.query.creatorCustomers.findMany({
				where: and(
					eq(creatorCustomers.creatorId, creatorId),
					eq(creatorCustomers.userId, buyerId),
				),
			});
			assert.equal(before.length, 1);
			const customerId = before[0].stripeCustomerId;

			const second = await startPurchase(
				creator,
				{ planId: plan.id, userId: buyerId },
				stubStripe().adapter,
			);
			assert.equal(second.status, "checkout");
			const after = await db.query.creatorCustomers.findMany({
				where: and(
					eq(creatorCustomers.creatorId, creatorId),
					eq(creatorCustomers.userId, buyerId),
				),
			});
			assert.equal(after.length, 1, "one Customer per buyer and creator");
			assert.equal(after[0].stripeCustomerId, customerId);

			// Paying the second attempt adds a separate grant.
			const pending = await db.query.payments.findFirst({
				where: and(
					eq(payments.planId, plan.id),
					eq(payments.status, "pending"),
				),
			});
			assert.ok(pending?.stripeCheckoutId);
			await fulfillPayment({
				checkoutSessionId: pending.stripeCheckoutId,
				amountPaid: 1000,
			});
			assert.equal(await balance(), 20);
		},
	);

	await t.test("an expired Checkout grants nothing", async () => {
		const third = await startPurchase(
			creator,
			{ planId: plan.id, userId: buyerId },
			stubStripe().adapter,
		);
		const payment = await db.query.payments.findFirst({
			where: eq(payments.id, third.paymentId as string),
		});
		assert.ok(payment?.stripeCheckoutId);
		await closePayment(payment.stripeCheckoutId, "expired");

		// A late success cannot resurrect an expired attempt.
		const late = await fulfillPayment({
			checkoutSessionId: payment.stripeCheckoutId,
			amountPaid: 1000,
		});
		assert.equal(late.status, "already_fulfilled");
		assert.equal(await balance(), 20);

		const reread = await db.query.payments.findFirst({
			where: eq(payments.id, payment.id),
		});
		assert.equal(reread?.status, "expired");
	});

	await t.test("a draft cannot be purchased", async () => {
		const draft = await createPlan(creator, {
			name: "Draft only",
			terms: {
				billingMode: "one_time",
				currency: "usd",
				price: 10,
				credits: 5,
			},
		});
		await assert.rejects(
			startPurchase(
				creator,
				{ planId: draft.id, userId: buyerId },
				stubStripe().adapter,
			),
			{ code: "PLAN_NOT_PUBLISHED" },
		);
	});

	await t.test(
		"only published terms are sold after a price change",
		async () => {
			await updatePlan(creator, plan.id, {
				terms: {
					billingMode: "one_time",
					currency: "usd",
					price: 50,
					credits: 40,
				},
			});
			// The draft holds $50 now, but the live offer is still $10 for 10 credits.
			const result = await startPurchase(
				creator,
				{ planId: plan.id, userId: buyerId },
				stubStripe().adapter,
			);
			const payment = await db.query.payments.findFirst({
				where: eq(payments.id, result.paymentId as string),
			});
			assert.equal(payment?.amountTotal, 1000);
			assert.equal(payment?.credits, 10);
		},
	);

	await t.test("another creator cannot buy into this plan", async () => {
		const other = sessionPrincipal(otherId);
		await assert.rejects(
			startPurchase(
				other,
				{ planId: plan.id, userId: buyerId },
				stubStripe().adapter,
			),
			{ code: "NOT_FOUND" },
		);
	});

	await t.test("a customer-account mismatch is refused", async () => {
		// Simulate the buyer's Customer having been created elsewhere.
		await db
			.update(creatorCustomers)
			.set({ stripeAccountId: "acct_other" })
			.where(
				and(
					eq(creatorCustomers.creatorId, creatorId),
					eq(creatorCustomers.userId, buyerId),
				),
			);
		await assert.rejects(
			startPurchase(
				creator,
				{ planId: plan.id, userId: buyerId },
				stubStripe().adapter,
			),
			{ code: "CUSTOMER_ACCOUNT_MISMATCH" },
		);
		await db
			.update(creatorCustomers)
			.set({ stripeAccountId: "acct_seller" })
			.where(
				and(
					eq(creatorCustomers.creatorId, creatorId),
					eq(creatorCustomers.userId, buyerId),
				),
			);
	});

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, otherId));
	await db.delete(user).where(eq(user.id, buyerId));
});

test("purchase request tokens are single-use and bound to one buyer", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	const creatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const strangerId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);
	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
		{ id: strangerId, name: "Stranger", email: `${strangerId}@example.test` },
	]);
	const plan = await createPlan(creator, {
		name: "Token plan",
		terms: { billingMode: "one_time", currency: "usd", price: 10, credits: 3 },
	});

	await t.test(
		"a forwarded link fails for a different signed-in user",
		async () => {
			const token = await issueCheckoutToken({
				creatorId,
				userId: buyerId,
				planId: plan.id,
			});
			await assert.rejects(redeemCheckoutToken({ token, userId: strangerId }), {
				code: "CHECKOUT_TOKEN_INVALID",
			});
			// The intended buyer can still use it: a stranger's attempt must not
			// consume the sender's link.
			const redeemed = await redeemCheckoutToken({ token, userId: buyerId });
			assert.equal(redeemed.planId, plan.id);
			assert.equal(redeemed.creatorId, creatorId);
		},
	);

	await t.test("a token works exactly once", async () => {
		const token = await issueCheckoutToken({
			creatorId,
			userId: buyerId,
			planId: plan.id,
		});
		await redeemCheckoutToken({ token, userId: buyerId });
		await assert.rejects(redeemCheckoutToken({ token, userId: buyerId }), {
			code: "CHECKOUT_TOKEN_INVALID",
		});
	});

	await t.test("concurrent redeems succeed only once", async () => {
		const token = await issueCheckoutToken({
			creatorId,
			userId: buyerId,
			planId: plan.id,
		});
		const results = await Promise.allSettled([
			redeemCheckoutToken({ token, userId: buyerId }),
			redeemCheckoutToken({ token, userId: buyerId }),
		]);
		assert.equal(
			results.filter((r) => r.status === "fulfilled").length,
			1,
			"only one concurrent redeem may win",
		);
	});

	await t.test("an expired token is refused", async () => {
		const token = await issueCheckoutToken({
			creatorId,
			userId: buyerId,
			planId: plan.id,
			ttlMs: -1000,
		});
		await assert.rejects(redeemCheckoutToken({ token, userId: buyerId }), {
			code: "CHECKOUT_TOKEN_INVALID",
		});
	});

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, buyerId));
	await db.delete(user).where(eq(user.id, strangerId));
});
