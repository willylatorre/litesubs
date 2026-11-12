/**
 * Refunds are where money flows backwards into credits. These tests target the
 * failures that would either give service away or corrupt history: revoking
 * another pack's units, double-revoking a duplicated event, minting a negative
 * balance, converting partial money into guessed units, and granting credits
 * after the purchase was already refunded.
 *
 * Real services and database; Stripe's HTTP layer is never called.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	creditGrants,
	enrollments,
	payments,
	planVersions,
	refunds,
	subscriptionInvoices,
	subscriptions,
	transactions,
	user,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { changeCredits, usableBalance } from "@/lib/services/credits";
import { createPlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import { publishPlan } from "@/lib/services/publish";
import {
	fulfillPayment,
	type PurchaseStripeAdapter,
	startPurchase,
} from "@/lib/services/purchase";
import { applyPaymentRefund } from "@/lib/services/refunds";
import type { PlanOfferAdapter } from "@/lib/stripe-offers";

let seq = 0;

function stubStripe(): PurchaseStripeAdapter {
	let customerSeq = 0;
	return {
		async createConnectedCustomer() {
			customerSeq += 1;
			return { id: `cus_refund_${customerSeq}` };
		},
		async createDirectCheckoutSession(input) {
			seq += 1;
			return {
				id: `cs_refund_${seq}`,
				url: `https://checkout.stripe.test/refund-${seq}`,
				priceId: input.lineItem.stripePriceId,
			} as never;
		},
	};
}

test("refunds revoke only the refunded purchase's unspent units", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);
	const accountId = `acct_${creatorId}`;

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
	]);
	await db.insert(connectedAccounts).values({
		userId: creatorId,
		stripeAccountId: accountId,
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
		createProduct: async () => ({ id: `prod_refund_${crypto.randomUUID()}` }),
		createPrice: async () => ({ id: `price_refund_${crypto.randomUUID()}` }),
		deactivateProduct: async () => {},
		deactivatePrice: async () => {},
	};
	const plan = await createPlan(creator, {
		name: "Refundable pack",
		terms: { billingMode: "one_time", currency: "usd", price: 10, credits: 10 },
	});
	await publishPlan(creator, { plan: plan.id }, offerAdapter);

	const buy = async () => {
		const start = await startPurchase(
			creator,
			{ planId: plan.id, userId: buyerId },
			stubStripe(),
		);
		const payment = await db.query.payments.findFirst({
			where: eq(payments.id, start.paymentId as string),
		});
		assert.ok(payment?.stripeCheckoutId);
		const paymentIntentId = `pi_${crypto.randomUUID()}`;
		await fulfillPayment({
			checkoutSessionId: payment.stripeCheckoutId,
			amountPaid: 1000,
			paymentIntentId,
		});
		const purchase = await db.query.transactions.findFirst({
			where: eq(transactions.stripeCheckoutId, payment.stripeCheckoutId),
		});
		return { payment, paymentIntentId, purchase };
	};
	const enrollmentRow = async () =>
		db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.userId, buyerId),
				eq(enrollments.planId, plan.id),
			),
		});
	const balance = async () => {
		const row = await enrollmentRow();
		if (!row) throw new Error("Enrollment missing");
		return usableBalance(db, row.id);
	};

	const first = await buy();
	const second = await buy();
	assert.equal(await balance(), 20);

	await t.test(
		"a consumed unit stays consumed and is not refunded twice",
		async () => {
			const machine = {
				kind: "apiKey" as const,
				creatorId,
				scopes: ["credits:consume"],
			};
			// Spend 4: soonest-expiry first, both have no expiry so oldest first.
			await changeCredits(
				machine,
				{
					customer: buyerId,
					plan: plan.id,
					amount: 4,
					reason: "Lesson",
					idempotency_key: "refund-lesson-1",
				},
				"usage",
			);
			assert.equal(await balance(), 16);
		},
	);

	await t.test(
		"a full refund revokes only the remaining units of that pack",
		async () => {
			const result = await applyPaymentRefund({
				stripeAccountId: accountId,
				stripeRefundId: "re_first",
				amount: 1000,
				currency: "usd",
				paymentIntentId: first.paymentIntentId,
			});
			assert.equal(result.status, "recorded");
			assert.equal(result.revokedCredits, 6, "4 of the first pack were used");
			assert.equal(await balance(), 10, "the second pack is untouched");

			const firstGrant = await db.query.creditGrants.findFirst({
				where: eq(
					creditGrants.sourceTransactionId,
					first.purchase?.id as string,
				),
			});
			assert.equal(firstGrant?.remaining, 0);
			const secondGrant = await db.query.creditGrants.findFirst({
				where: eq(
					creditGrants.sourceTransactionId,
					second.purchase?.id as string,
				),
			});
			assert.equal(secondGrant?.remaining, 10);

			const receipt = await db.query.payments.findFirst({
				where: eq(payments.id, first.payment.id),
			});
			assert.equal(receipt?.status, "refunded");
			assert.equal(receipt?.amountRefunded, 1000);

			const revocation = await db.query.transactions.findFirst({
				where: eq(transactions.idempotencyKey, "refund:re_first"),
			});
			assert.equal(revocation?.type, "refund");
			assert.equal(revocation?.amount, -6);
		},
	);

	await t.test("a duplicated refund event is idempotent", async () => {
		const result = await applyPaymentRefund({
			stripeAccountId: accountId,
			stripeRefundId: "re_first",
			amount: 1000,
			currency: "usd",
			paymentIntentId: first.paymentIntentId,
		});
		assert.equal(result.status, "already_recorded");
		assert.equal(await balance(), 10);
		assert.equal(
			(
				await db.query.refunds.findMany({
					where: eq(refunds.stripeRefundId, "re_first"),
				})
			).length,
			1,
		);
	});

	await t.test("partial refunds move money, not guessed credits", async () => {
		const partial = await applyPaymentRefund({
			stripeAccountId: accountId,
			stripeRefundId: "re_partial_1",
			amount: 400,
			currency: "usd",
			paymentIntentId: second.paymentIntentId,
		});
		assert.equal(partial.status, "recorded");
		assert.equal(partial.revokedCredits, 0);
		assert.equal(partial.requiresAdjustment, true);
		assert.equal(await balance(), 10, "nothing revoked for partial money");

		const receipt = await db.query.payments.findFirst({
			where: eq(payments.id, second.payment.id),
		});
		// Full amount not reached: the payment stays paid, not refunded.
		assert.equal(receipt?.status, "paid");
		assert.equal(receipt?.amountRefunded, 400);

		const completing = await applyPaymentRefund({
			stripeAccountId: accountId,
			stripeRefundId: "re_partial_2",
			amount: 600,
			currency: "usd",
			paymentIntentId: second.paymentIntentId,
		});
		assert.equal(completing.status, "recorded");
		assert.equal(completing.revokedCredits, 10);
		assert.equal(completing.requiresAdjustment, false);
		assert.equal(await balance(), 0);

		const done = await db.query.payments.findFirst({
			where: eq(payments.id, second.payment.id),
		});
		assert.equal(done?.status, "refunded");
		assert.equal(done?.amountRefunded, 1000);
		void done;
	});

	await t.test("an unknown charge is not made up locally", async () => {
		const result = await applyPaymentRefund({
			stripeAccountId: accountId,
			stripeRefundId: "re_unknown",
			amount: 500,
			currency: "usd",
			paymentIntentId: "pi_not_ours",
		});
		assert.equal(result.status, "ignored");
	});

	await t.test(
		"refund before fulfillment cannot later grant credits",
		async () => {
			const start = await startPurchase(
				creator,
				{ planId: plan.id, userId: buyerId },
				stubStripe(),
			);
			const pending = await db.query.payments.findFirst({
				where: eq(payments.id, start.paymentId as string),
			});
			assert.ok(pending?.stripeCheckoutId);
			const pendingIntent = `pi_${crypto.randomUUID()}`;
			// The buyer sets the intent before the confirming webhook is processed.
			await db
				.update(payments)
				.set({ stripePaymentIntentId: pendingIntent })
				.where(eq(payments.id, pending.id));

			const refunded = await applyPaymentRefund({
				stripeAccountId: accountId,
				stripeRefundId: "re_before_grant",
				amount: 1000,
				currency: "usd",
				paymentIntentId: pendingIntent,
			});
			assert.equal(refunded.status, "recorded");
			assert.equal(refunded.revokedCredits, 0);

			const late = await fulfillPayment({
				checkoutSessionId: pending.stripeCheckoutId,
				amountPaid: 1000,
				paymentIntentId: pendingIntent,
			});
			assert.equal(late.status, "already_fulfilled");
			assert.equal(await balance(), 0, "no spendable refunded units");
			const receipt = await db.query.payments.findFirst({
				where: eq(payments.id, pending.id),
			});
			assert.equal(receipt?.status, "refunded");
		},
	);

	await t.test(
		"a refund that beats the confirming webhook still blocks the grant",
		async () => {
			// Nothing has stored the PaymentIntent on the receipt yet; only the
			// metadata correlation from Checkout creation exists.
			const start = await startPurchase(
				creator,
				{ planId: plan.id, userId: buyerId },
				stubStripe(),
			);
			const pending = await db.query.payments.findFirst({
				where: eq(payments.id, start.paymentId as string),
			});
			assert.ok(pending?.stripeCheckoutId);
			assert.equal(pending.status, "pending");

			const refunded = await applyPaymentRefund({
				stripeAccountId: accountId,
				stripeRefundId: "re_metadata_fallback",
				amount: 1000,
				currency: "usd",
				paymentIntentId: null,
				fallbackPaymentId: pending.id,
			});
			assert.equal(refunded.status, "recorded");
			assert.equal(refunded.revokedCredits, 0);

			const receipt = await db.query.payments.findFirst({
				where: eq(payments.id, pending.id),
			});
			assert.equal(receipt?.status, "refunded");

			const late = await fulfillPayment({
				checkoutSessionId: pending.stripeCheckoutId,
				amountPaid: 1000,
				paymentIntentId: `pi_${crypto.randomUUID()}`,
			});
			assert.equal(late.status, "already_fulfilled");
			assert.equal(await balance(), 0);
		},
	);

	await t.test(
		"refunding a monthly invoice does not cancel the subscription",
		async () => {
			const monthly = await createPlan(creator, {
				name: "Monthly refund",
				terms: {
					billingMode: "recurring",
					interval: "month",
					currency: "usd",
					price: 20,
					credits: 5,
				},
			});
			await publishPlan(creator, { plan: monthly.id }, offerAdapter);
			const version = await db.query.planVersions.findFirst({
				where: and(
					eq(planVersions.planId, monthly.id),
					eq(planVersions.status, "published"),
				),
			});
			assert.ok(version);
			const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const periodEnd = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);
			const [subscription] = await db
				.insert(subscriptions)
				.values({
					creatorId,
					userId: buyerId,
					planId: monthly.id,
					planVersionId: version.id,
					stripeAccountId: accountId,
					stripeCustomerId: `cus_monthly_${crypto.randomUUID()}`,
					stripeSubscriptionId: `sub_${crypto.randomUUID()}`,
					status: "active",
					applicationFeePercent: 2,
					paidThroughAt: periodEnd,
				})
				.returning();
			const invoiceIntent = `pi_${crypto.randomUUID()}`;
			const [invoice] = await db
				.insert(subscriptionInvoices)
				.values({
					subscriptionId: subscription.id,
					stripeAccountId: accountId,
					stripeInvoiceId: `in_${crypto.randomUUID()}`,
					stripePaymentIntentId: invoiceIntent,
					amountPaid: 2000,
					currency: "usd",
					periodStart,
					periodEnd,
					paidAt: new Date(),
					creditedAt: new Date(),
				})
				.returning();
			const [monthlyEnrollment] = await db
				.insert(enrollments)
				.values({
					creatorId,
					userId: buyerId,
					planId: monthly.id,
					credits: 5,
				})
				.onConflictDoUpdate({
					target: [enrollments.userId, enrollments.planId],
					set: { updatedAt: new Date() },
				})
				.returning();
			const [entry] = await db
				.insert(transactions)
				.values({
					userId: buyerId,
					creatorId,
					planId: monthly.id,
					planVersionId: version.id,
					amount: 5,
					amountMoney: 2000,
					currency: "usd",
					type: "purchase",
					status: "completed",
					description: "Monthly allowance: 5 credits",
					subscriptionInvoiceId: invoice.id,
					usesStripeConnect: false,
					balanceBefore: 0,
					balanceAfter: 5,
				})
				.returning();
			await db.insert(creditGrants).values({
				enrollmentId: monthlyEnrollment.id,
				creatorId,
				userId: buyerId,
				planId: monthly.id,
				planVersionId: version.id,
				sourceTransactionId: entry.id,
				kind: "period",
				amount: 5,
				remaining: 5,
				expiresAt: periodEnd,
			});

			const result = await applyPaymentRefund({
				stripeAccountId: accountId,
				stripeRefundId: "re_monthly",
				amount: 2000,
				currency: "usd",
				paymentIntentId: invoiceIntent,
			});
			assert.equal(result.revokedCredits, 5);
			const liveSubscription = await db.query.subscriptions.findFirst({
				where: eq(subscriptions.id, subscription.id),
			});
			assert.equal(liveSubscription?.status, "active");
			assert.equal(
				liveSubscription?.paidThroughAt?.getTime(),
				periodEnd.getTime(),
			);
			const refundedInvoice = await db.query.subscriptionInvoices.findFirst({
				where: eq(subscriptionInvoices.id, invoice.id),
			});
			assert.equal(refundedInvoice?.amountRefunded, 2000);
		},
	);

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, buyerId));
});
