/**
 * The integration contract a platform (Plannerie first) depends on:
 *
 * - an OAuth connection can mint itself a consume-only key, and a machine key
 *   cannot mint anything;
 * - a teacher can provision a customer who has never signed in, and that
 *   customer can be debited immediately;
 * - the same provision is idempotent, so a retry cannot fork one learner.
 *
 * These are the guarantees `docs/INTEGRATION.md` promises. If they break, the
 * enable flow silently stops working rather than failing loudly, which is why
 * they are exercised against a real database.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	apikey,
	creatorCustomers,
	creditGrants,
	enrollments,
	plans,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { changeCredits, usableBalance } from "@/lib/services/credits";
import { listTransactions } from "@/lib/services/customers";
import {
	listIntegrationKeys,
	mintIntegrationKey,
	revokeIntegrationKey,
} from "@/lib/services/integration";
import { type Principal, ServiceError } from "@/lib/services/principal";
import { provisionCustomer } from "@/lib/services/provisioning";
import { grantTestPremium } from "@/lib/test-premium";

function oauth(creatorId: string): Principal {
	return {
		kind: "oauth",
		creatorId,
		scopes: [
			"plans:read",
			"plans:write",
			"customers:read",
			"customers:write",
			"billing:read",
		],
	};
}

function machine(creatorId: string): Principal {
	return { kind: "apiKey", creatorId, scopes: ["credits:consume"] };
}

async function seedCreator(creatorId: string) {
	await db.insert(user).values({
		id: creatorId,
		name: "Creator",
		username: `c${creatorId.slice(0, 8)}`,
		email: `${creatorId}@example.test`,
	});
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
	const [plan] = await db
		.insert(plans)
		.values({ creatorId, name: "Lessons" })
		.returning();
	await db.insert(planVersions).values({
		planId: plan.id,
		creatorId,
		status: "published",
		billingMode: "one_time",
		currency: "usd",
		price: 1000,
		credits: 5,
		version: 1,
		stripePriceId: `price_${plan.id}`,
		stripeProductId: `prod_${plan.id}`,
		stripeAccountId: `acct_${creatorId}`,
	});
	return plan;
}

test("a connection mints a consume key, and only a connection may", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	const creatorId = crypto.randomUUID();
	await seedCreator(creatorId);

	// Minting a key is a developer feature: the integration endpoint must not be
	// a back door around the Premium tier that sells it. This is the regression
	// that a probe caught — a free creator could mint via this path while the
	// dashboard gate refused.
	await assert.rejects(
		() => mintIntegrationKey(oauth(creatorId)),
		(error) =>
			error instanceof ServiceError && error.code === "PREMIUM_REQUIRED",
	);

	await grantTestPremium(creatorId);

	// A machine key must never mint: that would let a leaked key escalate to a
	// fresh long-lived credential and make the scope split meaningless.
	await assert.rejects(
		() => mintIntegrationKey(machine(creatorId)),
		(error) => error instanceof ServiceError && error.code === "FORBIDDEN",
	);

	const minted = await mintIntegrationKey(oauth(creatorId));
	assert.ok(minted.key, "the raw key is returned once, at creation");
	assert.ok(minted.key?.startsWith("ls_"), "uses the configured prefix");

	// The minted key is bound to the creator and carries exactly the documented
	// management-plus-consumption scopes — including `webhooks:manage` being
	// deliberately absent, because a delegated key must not choose where a
	// tenant's data is sent.
	const [row] = await db.select().from(apikey).where(eq(apikey.id, minted.id));
	assert.equal(row.referenceId, creatorId);
	// Stored as JSON text by the api-key plugin, not as a jsonb object.
	assert.deepEqual(JSON.parse(row.permissions ?? "{}"), {
		credits: ["consume"],
		customers: ["read", "write"],
		plans: ["read", "write"],
		billing: ["read"],
	});
	// Ownership is recorded so a key can be found again regardless of its name.
	const metadata = JSON.parse(row.metadata ?? "{}");
	assert.equal(metadata.litesubsIntegrationKey, "platform-billing");

	// Minting twice refuses rather than piling up identical credentials, because
	// the secret cannot be shown a second time.
	await assert.rejects(
		() => mintIntegrationKey(oauth(creatorId)),
		(error) => error instanceof ServiceError && error.code === "KEY_EXISTS",
	);

	// Listing never returns a secret.
	const listed = await listIntegrationKeys(oauth(creatorId));
	assert.equal(listed.length, 1);
	assert.equal("key" in listed[0], false);

	// Revoking with the connection kills the credential; it must not survive.
	await revokeIntegrationKey(oauth(creatorId), minted.id);
	const after = await listIntegrationKeys(oauth(creatorId));
	assert.equal(after.length, 0);

	// Another creator's connection can neither see nor revoke it.
	const otherId = crypto.randomUUID();
	await seedCreator(otherId);
	await assert.rejects(
		() => revokeIntegrationKey(oauth(otherId), minted.id),
		(error) => error instanceof ServiceError && error.code === "NOT_FOUND",
	);

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, otherId));
});

/**
 * Key ownership is the marker, not the label.
 *
 * Names are user-facing: a creator can call their own dashboard key "Platform
 * consumption". Matching on the name then refuses a legitimate mint, and a
 * caller that picks a different name mints a key it can never list or revoke —
 * a credential that spends the creator's balance and cannot be taken away by
 * the connection that created it.
 */
test("integration keys are owned by marker, not by their display name", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	await seedCreator(creatorId);
	await grantTestPremium(creatorId);

	// A dashboard key the creator made themselves, sharing the default label.
	// Imported lazily: `@/lib/auth` initialises Better Auth and touches the
	// database at module load, which a skipped test must not require.
	const { auth } = await import("@/lib/auth");
	const dashboardKey = await auth.api.createApiKey({
		body: {
			name: "Platform consumption",
			userId: creatorId,
			permissions: { credits: ["consume"] } as Record<string, string[]>,
		},
	});

	// The label collision must not block the connection's own mint.
	const minted = await mintIntegrationKey(oauth(creatorId));
	assert.ok(minted.key);

	// A caller-chosen label must still be listable and revocable.
	const renamed = await mintIntegrationKey(oauth(creatorId), {
		name: "renamed by the caller",
	}).catch((error) => error);
	assert.ok(
		renamed instanceof ServiceError && renamed.code === "KEY_EXISTS",
		"a second live integration key is still refused",
	);

	await revokeIntegrationKey(oauth(creatorId), minted.id);
	const second = await mintIntegrationKey(oauth(creatorId), {
		name: "renamed by the caller",
	});
	const listed = await listIntegrationKeys(oauth(creatorId));
	assert.deepEqual(
		listed.map((key) => key.id),
		[second.id],
		"a custom-named integration key must still be visible to its owner",
	);
	// Revoking it must work even though the name is not the default.
	await revokeIntegrationKey(oauth(creatorId), second.id);
	assert.equal((await listIntegrationKeys(oauth(creatorId))).length, 0);

	// The creator's own key is untouched by any of this.
	await assert.rejects(
		() => revokeIntegrationKey(oauth(creatorId), dashboardKey.id),
		(error) => error instanceof ServiceError && error.code === "NOT_FOUND",
	);

	await db.delete(user).where(eq(user.id, creatorId));
});

/**
 * The ledger an integration reads must not include the platform's internal
 * Stripe linkage.
 *
 * `transactions` carries the Checkout session id, the creator's connected
 * account id, and the application fee for reconciliation. Spreading the row put
 * all of it in `GET /transactions`, so any key with `billing:read` could read
 * the creator's connected account id and the exact Checkout behind every sale.
 * None of it helps a consumer, and all of it is a third party's identifier.
 */
test("the ledger a client reads exposes no internal Stripe identifiers", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const plan = await seedCreator(creatorId);

	await db.insert(transactions).values({
		id: crypto.randomUUID(),
		creatorId,
		userId: creatorId,
		planId: plan.id,
		amount: 5,
		amountMoney: 1_000,
		currency: "usd",
		type: "purchase",
		status: "completed",
		description: "Sold a pack",
		stripeCheckoutId: `cs_test_internal_${creatorId.slice(0, 8)}`,
		usesStripeConnect: true,
		stripeConnectAccountId: `acct_internal_${creatorId.slice(0, 8)}`,
		stripeApplicationFee: 0,
	});

	const rows = await listTransactions(oauth(creatorId), { limit: 10 });
	assert.equal(rows.length, 1);
	const row = rows[0] as Record<string, unknown>;
	for (const internal of [
		"stripeCheckoutId",
		"stripeConnectAccountId",
		"stripeApplicationFee",
		"usesStripeConnect",
		"subscriptionInvoiceId",
		"creatorId",
	]) {
		assert.equal(
			internal in row,
			false,
			`GET /transactions must not expose ${internal}`,
		);
	}
	// The fields a consumer actually needs are still there.
	assert.equal(row.amount, 5);
	assert.equal(row.amountMoney, 1_000);
	assert.equal(row.status, "completed");

	await db.delete(user).where(eq(user.id, creatorId));
});

test("a teacher can provision a customer who never signs in, then debit them", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	const creatorId = crypto.randomUUID();
	const plan = await seedCreator(creatorId);
	// Provisioning is customers:write, not a developer feature, so free is fine —
	// but grant premium anyway so the test is not accidentally coupled to it.
	await grantTestPremium(creatorId);
	const email = `learner-${creatorId.slice(0, 8)}@example.test`;

	const provisioned = await provisionCustomer(oauth(creatorId), { email });
	assert.equal(provisioned.created, true);
	assert.equal(provisioned.unclaimed, true, "no password exists yet");

	// The account is real but cannot sign in.
	const [account] = await db
		.select({ emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, provisioned.customerId));
	assert.equal(account.emailVerified, false);

	// Linked to this creator as a customer.
	const link = await db.query.creatorCustomers.findFirst({
		where: and(
			eq(creatorCustomers.creatorId, creatorId),
			eq(creatorCustomers.userId, provisioned.customerId),
		),
	});
	assert.ok(link);

	// Provisioning is idempotent per (creator, email): a retry must not fork the
	// learner into a second account.
	const again = await provisionCustomer(oauth(creatorId), { email });
	assert.equal(again.customerId, provisioned.customerId);
	assert.equal(again.created, false);

	// Enroll and grant, then consume — all before the learner has ever logged in.
	// Provisioning with a plan must produce the enrollment itself: a test that
	// inserts it by hand passes even when the endpoint leaves the customer
	// unusable, which is exactly the defect this now guards against.
	const withPlan = await provisionCustomer(oauth(creatorId), {
		email,
		plan: plan.id,
	});
	assert.equal(withPlan.customerId, provisioned.customerId);
	assert.equal(withPlan.planId, plan.id);

	const enrollment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.creatorId, creatorId),
			eq(enrollments.userId, provisioned.customerId),
			eq(enrollments.planId, plan.id),
		),
	});
	assert.ok(enrollment, "provisioning a plan must create the enrollment");

	await changeCredits(
		oauth(creatorId),
		{
			customer: email,
			plan: plan.id,
			amount: 5,
			reason: "Teacher granted a starter pack",
		},
		"manual_adjustment",
	);

	// The debit a booking would make, against the unclaimed customer.
	await changeCredits(
		machine(creatorId),
		{
			customer: email,
			plan: plan.id,
			amount: 1,
			reason: "Lesson booked",
			idempotency_key: `booking:${crypto.randomUUID()}`,
		},
		"usage",
	);

	const balance = await usableBalance(db, enrollment.id);
	assert.equal(balance, 4);

	// The ledger is keyed by enrollment, not by the learner being signed in —
	// which is the whole reason an unclaimed customer can be debited at all.
	const grants = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.enrollmentId, enrollment.id));
	assert.ok(grants.length > 0);

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, provisioned.customerId));
});
