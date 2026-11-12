/**
 * Connect OAuth state handling is a security boundary: a callback must belong
 * to the creator who started it, work exactly once, and never silently switch
 * an account that already has customers.
 *
 * These run against the real service and database. Stripe calls are stubbed at
 * the adapter boundary because the assertions are about state and account
 * selection, not Stripe's HTTP behaviour.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import { enrollments, plans, planVersions, user } from "@/app/db/schema";
import {
	connectedAccounts,
	connectOauthStates,
} from "@/app/db/stripe-connect-schema";

test("Connect OAuth state is single-use, user-bound, and refuses account switching", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherId = crypto.randomUUID();
	const newerId = crypto.randomUUID();
	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: otherId, name: "Other", email: `${otherId}@example.test` },
		{ id: newerId, name: "Newer", email: `${newerId}@example.test` },
	]);

	const { startExistingAccountConnection, completeExistingAccountConnection } =
		await import("@/lib/services/connect");

	// Substitute only the Stripe calls; state, accounts and readiness are real.
	type Adapter = import("@/lib/services/connect").ConnectStripeAdapter;
	type Account = Awaited<ReturnType<Adapter["retrieveConnectedAccount"]>>;
	let nextAccountId = "acct_existing";
	let accountShape = {
		controller: {
			type: "account",
			stripe_dashboard: { type: "full" },
			fees: { payer: "account" },
			losses: { payments: "stripe" },
		},
		charges_enabled: true,
		payouts_enabled: true,
		details_submitted: true,
		country: "US",
		default_currency: "usd",
		requirements: { currently_due: [], disabled_reason: null },
	};
	const adapter: Adapter = {
		exchangeAuthorizationCode: async () =>
			({
				stripe_user_id: nextAccountId,
				livemode: false,
				scope: "read_write",
			}) as unknown as Awaited<
				ReturnType<Adapter["exchangeAuthorizationCode"]>
			>,
		retrieveConnectedAccount: async () =>
			({ id: nextAccountId, ...accountShape }) as unknown as Account,
	};

	// The service reads the client id from env; set it for this run.
	const previousClientId = process.env.STRIPE_CONNECT_CLIENT_ID;
	process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test";

	try {
		const start = await startExistingAccountConnection(creatorId);
		const state = new URL(start.url).searchParams.get("state");
		assert.ok(state, "authorize URL must carry our state");
		assert.match(start.url, /connect\.stripe\.com\/oauth\/authorize/);
		assert.match(start.url, /scope=read_write/);
		// Only a hash is persisted.
		const stored = await db.query.connectOauthStates.findFirst({
			where: eq(connectOauthStates.userId, creatorId),
		});
		assert.ok(stored);
		assert.notEqual(stored.stateHash, state);

		await t.test(
			"another user cannot complete someone else's state",
			async () => {
				await assert.rejects(
					completeExistingAccountConnection(
						{ creatorId: otherId, state, code: "acct_code" },
						adapter,
					),
					{ code: "OAUTH_STATE_INVALID" },
				);
				// The state must survive a failed cross-user attempt.
				const stillOpen = await db.query.connectOauthStates.findFirst({
					where: eq(connectOauthStates.stateHash, stored.stateHash),
				});
				assert.equal(stillOpen?.consumedAt, null);
			},
		);

		await t.test("a callback works once and a replay is rejected", async () => {
			const first = await completeExistingAccountConnection(
				{ creatorId, state, code: "acct_code" },
				adapter,
			);
			assert.equal(first.accountId, "acct_existing");
			assert.equal(first.compatible, true);

			await assert.rejects(
				completeExistingAccountConnection(
					{ creatorId, state, code: "acct_code" },
					adapter,
				),
				{ code: "OAUTH_STATE_INVALID" },
			);

			const rows = await db.query.connectedAccounts.findMany({
				where: eq(connectedAccounts.userId, creatorId),
			});
			assert.equal(rows.length, 1);
			assert.equal(rows[0].authorizedViaOauth, true);
			assert.equal(rows[0].onboardingMode, "connected");
		});

		await t.test(
			"reconnecting the same account restores the mapping",
			async () => {
				const again = await startExistingAccountConnection(creatorId);
				const state2 = new URL(again.url).searchParams.get("state");
				nextAccountId = "acct_existing";
				const result = await completeExistingAccountConnection(
					{ creatorId, state: state2 as string, code: "acct_code" },
					adapter,
				);
				assert.equal(result.accountId, "acct_existing");
				const rows = await db.query.connectedAccounts.findMany({
					where: eq(connectedAccounts.userId, creatorId),
				});
				assert.equal(rows.length, 1);
			},
		);

		await t.test(
			"a different account is refused once the creator has customers",
			async () => {
				const [plan] = await db
					.insert(plans)
					.values({ creatorId, name: "With customers" })
					.returning();
				await db.insert(planVersions).values({
					planId: plan.id,
					creatorId,
					status: "published",
					billingMode: "one_time",
					currency: "usd",
					price: 1000,
					credits: 1,
					version: 1,
					publishedAt: new Date(),
				});
				await db.insert(enrollments).values({
					userId: otherId,
					planId: plan.id,
					creatorId,
					credits: 1,
				});

				await assert.rejects(startExistingAccountConnection(creatorId), {
					code: "ACCOUNT_SWITCH_UNSUPPORTED",
				});

				// Even racing straight to a callback cannot swap the account.
				const pending = await db.query.connectOauthStates.findFirst({
					where: eq(connectOauthStates.userId, creatorId),
				});
				assert.ok(pending);
				nextAccountId = "acct_different";
				await assert.rejects(
					completeExistingAccountConnection(
						{ creatorId, state: "not-a-real-state", code: "acct_code" },
						adapter,
					),
					{ code: "OAUTH_STATE_INVALID" },
				);
				const rows = await db.query.connectedAccounts.findMany({
					where: eq(connectedAccounts.userId, creatorId),
				});
				assert.equal(rows[0].stripeAccountId, "acct_existing");
			},
		);

		await t.test(
			"an incompatible account is stored but never sellable",
			async () => {
				accountShape = {
					controller: {
						type: "application",
						stripe_dashboard: { type: "express" },
						fees: { payer: "application" },
						losses: { payments: "application" },
					},
					charges_enabled: true,
					payouts_enabled: true,
					details_submitted: true,
					country: "US",
					default_currency: "usd",
					requirements: { currently_due: [], disabled_reason: null },
				};
				nextAccountId = "acct_express";
				const start2 = await startExistingAccountConnection(newerId);
				const state3 = new URL(start2.url).searchParams.get("state");
				const result = await completeExistingAccountConnection(
					{ creatorId: newerId, state: state3 as string, code: "acct_code" },
					adapter,
				);
				assert.equal(result.compatible, false);
				assert.ok(result.issues.includes("platform_controlled"));

				const { getPaymentReadiness } = await import("@/lib/services/connect");
				const readiness = await getPaymentReadiness(newerId);
				// Stripe would accept a charge, but the agreement does not hold.
				assert.equal(readiness.chargesEnabled, true);
				assert.equal(readiness.canSell, false);
				assert.equal(readiness.compatible, false);
			},
		);
	} finally {
		if (previousClientId === undefined)
			delete process.env.STRIPE_CONNECT_CLIENT_ID;
		else process.env.STRIPE_CONNECT_CLIENT_ID = previousClientId;
		for (const id of [creatorId, otherId, newerId])
			await db.delete(user).where(eq(user.id, id));
		await db.$client.end();
	}
});
