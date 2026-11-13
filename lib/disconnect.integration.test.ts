/**
 * Disconnecting a Stripe account must never leave a customer billed for credits
 * nobody can grant. These cases run the real disconnect service against the
 * database and substitute only the Stripe subscription mutation, because the
 * contract under test is the local decision and its recorded outcome:
 *
 * - a live subscription refuses a silent disconnect,
 * - the explicit choice stops renewals without moving the paid period,
 * - the cause is recorded so it is not read as a customer cancellation,
 * - a Stripe failure leaves a visible, retryable state instead of a false success,
 * - a renewal that is still collected on a disconnected account grants nothing.
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
	subscriptions,
	transactions,
	user,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import {
	listLiveSubscriptions,
	stopLiveSubscriptions,
} from "@/lib/services/account-disconnect";
import {
	disconnectAccount,
	markAccountDeauthorized,
} from "@/lib/services/connect";
import { usableBalance } from "@/lib/services/credits";
import { getCustomer } from "@/lib/services/customers";
import { createPlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import { publishPlan } from "@/lib/services/publish";
import {
	fulfillSubscriptionInvoice,
	type SubscriptionStripeAdapter,
	startSubscription,
} from "@/lib/services/purchase";
import type { SubscriptionManagementAdapter } from "@/lib/services/subscriptions";
import type { PlanOfferAdapter } from "@/lib/stripe-offers";
import { subscriptionDisplayState } from "@/lib/subscription-state";

function managementAdapter(
	behaviour: "ok" | "refuse" = "ok",
	calls: Parameters<SubscriptionManagementAdapter["update"]>[0][] = [],
	end = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
	// The service rejects a response whose Customer differs from the stored one,
	// so the stub must echo the identity it was asked about.
	customerId = "cus_echo",
): SubscriptionManagementAdapter {
	return {
		async update(input) {
			calls.push(input);
			if (behaviour === "refuse") throw new Error("Stripe is unreachable");
			return {
				id: input.stripeSubscriptionId,
				customer: customerId,
				status: "active",
				cancel_at_period_end: input.cancelAtPeriodEnd,
				cancel_at: input.cancelAtPeriodEnd
					? Math.floor(end.getTime() / 1000)
					: null,
				items: {
					data: [{ current_period_end: Math.floor(end.getTime() / 1000) }],
				},
			} as never;
		},
	};
}

test("disconnecting a creator with live subscriptions stops renewals without granting more credits", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
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
		authorizedViaOauth: false,
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

	const adapter: PlanOfferAdapter = {
		createProduct: async (input) => ({ id: `prod_${input.versionId}` }),
		createPrice: async (input) => ({ id: `price_${input.versionId}` }),
		deactivateProduct: async () => {},
		deactivatePrice: async () => {},
	};
	const plan = await createPlan(creator, {
		name: "Monthly sessions",
		terms: {
			billingMode: "recurring",
			interval: "month",
			currency: "usd",
			price: 2000,
			credits: 12,
		},
	});
	const versionId = plan.terms?.id as string;
	await publishPlan(creator, { plan: plan.id }, adapter);

	const subscriptionAdapter: SubscriptionStripeAdapter = {
		createConnectedCustomer: async () => ({ id: `cus_${buyerId}` }),
		createDirectSubscriptionCheckoutSession: async (input) =>
			({
				id: `cs_${creatorId}`,
				url: `https://checkout.stripe.test/${input.applicationFeePercent}`,
			}) as never,
	};
	const started = await startSubscription(
		creator,
		{ planId: plan.id, userId: buyerId },
		subscriptionAdapter,
	);
	const subscriptionId = started.paymentId as string;
	const paidPeriodEnd = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000);

	// Make it a live Stripe subscription; the first paid invoice sets the period.
	await db
		.update(subscriptions)
		.set({
			stripeSubscriptionId: `sub_${creatorId}`,
			status: "active",
			paidThroughAt: null,
		})
		.where(eq(subscriptions.id, subscriptionId));
	await fulfillSubscriptionInvoice({
		subscriptionId,
		stripeSubscriptionId: `sub_${creatorId}`,
		stripeAccountId: `acct_${creatorId}`,
		stripeInvoiceId: `in_${creatorId}`,
		billingReason: "subscription_create",
		amountPaid: 2000,
		currency: "usd",
		periodStart: new Date(Date.now() - 60_000),
		periodEnd: paidPeriodEnd,
		paidAt: new Date(),
	});
	const enrollment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, buyerId),
			eq(enrollments.planId, plan.id),
		),
	});
	assert.equal(await usableBalance(db, enrollment?.id as string), 12);

	await t.test("a live subscription refuses a silent disconnect", async () => {
		const live = await listLiveSubscriptions(creatorId);
		assert.equal(live.length, 1);
		await assert.rejects(disconnectAccount(creatorId), {
			code: "SUBSCRIPTIONS_LIVE",
		});
		const account = await db.query.connectedAccounts.findFirst({
			where: eq(connectedAccounts.userId, creatorId),
		});
		assert.equal(account?.disconnectedAt, null, "nothing was detached");
		const untouched = await db.query.subscriptions.findFirst({
			where: eq(subscriptions.id, subscriptionId),
		});
		assert.equal(untouched?.cancelAtPeriodEnd, false);
	});

	await t.test(
		"a Stripe failure leaves a visible retryable state, not a disconnect",
		async () => {
			const calls: Parameters<SubscriptionManagementAdapter["update"]>[0][] =
				[];
			await assert.rejects(
				disconnectAccount(
					creatorId,
					{ cancelLiveSubscriptions: true },
					managementAdapter("refuse", calls),
				),
				{ code: "DISCONNECT_INCOMPLETE" },
			);
			assert.equal(calls.length, 1);
			const account = await db.query.connectedAccounts.findFirst({
				where: eq(connectedAccounts.userId, creatorId),
			});
			assert.equal(account?.disconnectedAt, null);
			assert.match(
				account?.disconnectFailure ?? "",
				/did not stop 1 subscription/,
			);
			assert.ok(account?.disconnectAttemptedAt);
			const untouched = await db.query.subscriptions.findFirst({
				where: eq(subscriptions.id, subscriptionId),
			});
			assert.equal(untouched?.cancelAtPeriodEnd, false);
		},
	);

	await t.test(
		"the explicit choice stops renewal and keeps the paid period intact",
		async () => {
			const calls: Parameters<SubscriptionManagementAdapter["update"]>[0][] =
				[];
			const result = await disconnectAccount(
				creatorId,
				{ cancelLiveSubscriptions: true },
				managementAdapter("ok", calls, paidPeriodEnd, `cus_${buyerId}`),
			);
			assert.equal(result.stoppedSubscriptions, 1);
			assert.equal(calls.length, 1);
			assert.equal(calls[0].cancelAtPeriodEnd, true);

			const stopped = await db.query.subscriptions.findFirst({
				where: eq(subscriptions.id, subscriptionId),
			});
			assert.equal(stopped?.cancelAtPeriodEnd, true);
			assert.equal(
				stopped?.cancellationCause,
				"creator_disconnect",
				"a disconnect is never recorded as a customer cancellation",
			);
			assert.equal(
				stopped?.paidThroughAt?.getTime(),
				paidPeriodEnd.getTime(),
				"disconnect never shortens a paid period",
			);
			assert.equal(await usableBalance(db, enrollment?.id as string), 12);

			const account = await db.query.connectedAccounts.findFirst({
				where: eq(connectedAccounts.userId, creatorId),
			});
			assert.ok(account?.disconnectedAt);
			assert.equal(account?.disconnectFailure, null);
		},
	);

	await t.test(
		"a renewal Stripe still collects grants no credits after disconnect",
		async () => {
			const renewalStart = paidPeriodEnd;
			const renewalEnd = new Date(
				paidPeriodEnd.getTime() + 28 * 24 * 60 * 60 * 1000,
			);
			const fulfilled = await fulfillSubscriptionInvoice({
				subscriptionId,
				stripeSubscriptionId: `sub_${creatorId}`,
				stripeAccountId: `acct_${creatorId}`,
				stripeInvoiceId: `in_unexpected_${creatorId}`,
				billingReason: "subscription_cycle",
				amountPaid: 2000,
				currency: "usd",
				periodStart: renewalStart,
				periodEnd: renewalEnd,
				paidAt: new Date(),
			});
			assert.equal(fulfilled.status, "fulfilled");
			assert.equal(fulfilled.credits, 0, "money moved, credits did not");
			assert.equal(await usableBalance(db, enrollment?.id as string), 12);
			assert.equal(
				(
					await db.query.creditGrants.findMany({
						where: eq(creditGrants.planId, plan.id),
					})
				).length,
				1,
			);
			// The money is still recorded honestly rather than dropped, and the
			// ledger explains why it produced no units.
			const ledger = await db.query.transactions.findMany({
				where: and(
					eq(transactions.planId, plan.id),
					eq(transactions.type, "purchase"),
				),
			});
			const unexpected = ledger.filter(
				(row) => row.amountMoney === 2000 && row.amount === 0,
			);
			assert.ok(
				unexpected.some((row) => /disconnected/i.test(row.description ?? "")),
				"the receipt says the account could not grant credits",
			);
		},
	);

	await t.test(
		"the customer sees an honest state, not a renewal that will not happen",
		async () => {
			const customer = await getCustomer(creator, buyerId);
			const billing = customer.enrollments[0].billingSubscription;
			assert.ok(billing);
			assert.equal(billing.cancellationCause, "creator_disconnect");
			assert.equal(
				subscriptionDisplayState({
					status: billing.status,
					paidThroughAt: billing.paidThroughAt,
					cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
					cancellationCause: billing.cancellationCause,
					overdue: billing.overdue,
				}),
				"creator_disconnected",
			);
		},
	);

	await t.test(
		"the deauthorization webhook applies the same handling",
		async () => {
			await db
				.update(connectedAccounts)
				.set({ disconnectedAt: null, status: "active" })
				.where(eq(connectedAccounts.userId, creatorId));
			await db
				.update(subscriptions)
				.set({ cancelAtPeriodEnd: false, cancellationCause: null })
				.where(eq(subscriptions.id, subscriptionId));

			const result = await markAccountDeauthorized(
				`acct_${creatorId}`,
				managementAdapter("ok", [], paidPeriodEnd, `cus_${buyerId}`),
			);
			assert.equal(result.handled, true);
			if (result.handled) {
				assert.equal(result.stoppedSubscriptions, 1);
				assert.equal(result.unhandledSubscriptions, 0);
			}
			const account = await db.query.connectedAccounts.findFirst({
				where: eq(connectedAccounts.userId, creatorId),
			});
			assert.ok(account?.disconnectedAt);
			const stopped = await db.query.subscriptions.findFirst({
				where: eq(subscriptions.id, subscriptionId),
			});
			assert.equal(stopped?.cancellationCause, "creator_disconnect");
			assert.equal(stopped?.paidThroughAt?.getTime(), paidPeriodEnd.getTime());
		},
	);

	await t.test("one-time packs need no cancellation", async () => {
		// Restore a sellable snapshot so the pack can be published through the
		// real readiness gate; the disconnect below is the thing under test.
		await db
			.update(connectedAccounts)
			.set({
				disconnectedAt: null,
				disconnectFailure: null,
				status: "active",
				chargesEnabled: true,
				cardPaymentsStatus: "active",
			})
			.where(eq(connectedAccounts.userId, creatorId));
		await db
			.update(subscriptions)
			.set({ status: "canceled" })
			.where(eq(subscriptions.id, subscriptionId));
		const pack = await createPlan(creator, {
			name: "One-time pack",
			terms: {
				billingMode: "one_time",
				currency: "usd",
				price: 1000,
				credits: 5,
			},
		});
		await publishPlan(creator, { plan: pack.id }, adapter);
		await db
			.update(subscriptions)
			.set({ status: "canceled" })
			.where(eq(subscriptions.id, subscriptionId));

		assert.equal((await listLiveSubscriptions(creatorId)).length, 0);
		const result = await stopLiveSubscriptions(creatorId);
		assert.deepEqual(result, { stopped: [], failed: [] });
		const disconnected = await disconnectAccount(creatorId);
		assert.equal(disconnected.stoppedSubscriptions, 0);
	});

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, buyerId));
	await db.$client.end();
});
