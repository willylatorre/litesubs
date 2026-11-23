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
	user,
} from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { changeCredits, usableBalance } from "@/lib/services/credits";
import {
	listIntegrationKeys,
	mintIntegrationKey,
	revokeIntegrationKey,
} from "@/lib/services/integration";
import {
	type Principal,
	ServiceError,
	sessionPrincipal,
} from "@/lib/services/principal";
import { provisionCustomer } from "@/lib/services/provisioning";

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

	// A machine key must never mint: that would let a leaked key escalate to a
	// fresh long-lived credential and make the scope split meaningless.
	await assert.rejects(
		() => mintIntegrationKey(machine(creatorId)),
		(error) =>
			error instanceof ServiceError && error.code === "FORBIDDEN",
	);

	const minted = await mintIntegrationKey(oauth(creatorId));
	assert.ok(minted.key, "the raw key is returned once, at creation");
	assert.ok(minted.key?.startsWith("ls_"), "uses the configured prefix");

	// The minted key is bound to the creator and limited to consumption.
	const [row] = await db
		.select()
		.from(apikey)
		.where(eq(apikey.id, minted.id));
	assert.equal(row.referenceId, creatorId);
	// Stored as JSON text by the api-key plugin, not as a jsonb object.
	assert.deepEqual(JSON.parse(row.permissions ?? "{}"), { credits: ["consume"] });

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

test("a teacher can provision a customer who never signs in, then debit them", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	const creatorId = crypto.randomUUID();
	const plan = await seedCreator(creatorId);
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
	await db.insert(enrollments).values({
		userId: provisioned.customerId,
		planId: plan.id,
		creatorId,
	});
	const enrollment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.creatorId, creatorId),
			eq(enrollments.userId, provisioned.customerId),
		),
	});
	assert.ok(enrollment);

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
