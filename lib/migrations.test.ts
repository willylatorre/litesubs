/**
 * Migrations must upgrade an existing database in place. These tests run the
 * real baseline plus every later migration against a throwaway database, so a
 * future edit that drops data or mis-backfills fails here instead of on a
 * deployment.
 *
 * Opt-in: set MIGRATION_TEST_DATABASE_URL to a disposable PostgreSQL database
 * the test may drop and recreate. Skipped otherwise so `npm test` stays offline.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

const MIGRATIONS = [
	"drizzle/0000_init.sql",
	"drizzle/0001_plans_enrollments.sql",
	"drizzle/0002_connected_accounts.sql",
	"drizzle/0003_connect_oauth.sql",
	"drizzle/0004_plan_publication.sql",
];

/** Create a fresh database, run `body`, then always drop it. */
async function withFreshDatabase(body: (client: pg.Client) => Promise<void>) {
	const database = process.env.MIGRATION_TEST_DATABASE_URL ?? "";
	const adminUrl = new URL(database);
	const dbName = adminUrl.pathname.slice(1);
	adminUrl.pathname = "/postgres";

	const admin = new pg.Client({ connectionString: adminUrl.toString() });
	await admin.connect();
	await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
	await admin.query(`CREATE DATABASE "${dbName}"`);
	await admin.end();

	const client = new pg.Client({ connectionString: database });
	await client.connect();
	try {
		await body(client);
	} finally {
		await client.end();
		const cleanup = new pg.Client({ connectionString: adminUrl.toString() });
		await cleanup.connect();
		await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}"`);
		await cleanup.end();
	}
}

async function apply(client: pg.Client, ...files: string[]) {
	for (const file of files) await client.query(await readFile(file, "utf8"));
}

test("0001 renames credit tables without losing rows", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, MIGRATIONS[0], MIGRATIONS[1]);

		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Student','s@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES
				('p1','u1','Active pack'),
				('p2','u1','Disabled pack');
			INSERT INTO enrollments(id,user_id,plan_id,creator_id,credits) VALUES
				('e1','u2','p1','u1',7);
			INSERT INTO invites(id,creator_id,token,plan_id) VALUES
				('i1','u1','tok1','p1');
			INSERT INTO transactions(id,user_id,creator_id,plan_id,amount,type,status) VALUES
				('t1','u2','u1','p1',10,'purchase','completed');
		`);

		const { rows: enrollments } = await client.query(
			"select id, plan_id, credits from enrollments",
		);
		assert.deepEqual(enrollments, [{ id: "e1", plan_id: "p1", credits: 7 }]);

		const { rows: ledger } = await client.query(
			"select id, plan_id from transactions",
		);
		assert.deepEqual(ledger, [{ id: "t1", plan_id: "p1" }]);

		const { rows: invite } = await client.query(
			"select id, plan_id from invites",
		);
		assert.deepEqual(invite, [{ id: "i1", plan_id: "p1" }]);

		// No platform Customer column survives the greenfield cleanup.
		const {
			rows: [column],
		} = await client.query(
			"select count(*)::int as n from information_schema.columns where table_name = 'user' and column_name = 'stripe_customer_id'",
		);
		assert.equal(column.n, 0);
	});
});

/**
 * Terms are backfilled from the pre-migration columns. A published plan keeps
 * selling its old price; a disabled one becomes a draft, never a silent price
 * change or a resurrected offer.
 */
test("0001 backfills published and draft terms from the old columns", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, MIGRATIONS[0]);
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES ('u1','Creator','c@example.test',true);
			INSERT INTO products(id,creator_id,name,price,credits,currency,type,active) VALUES
				('p_active','u1','Active pack',1000,10,'usd','one_time',true),
				('p_disabled','u1','Disabled pack',2000,20,'usd','one_time',false),
				('p_monthly','u1','Monthly',3000,30,'eur','recurring',true);
		`);
		await apply(client, MIGRATIONS[1]);

		const { rows } = await client.query(
			"select plan_id, status, billing_mode, interval, currency, price, credits from plan_versions order by plan_id",
		);
		assert.deepEqual(rows, [
			{
				plan_id: "p_active",
				status: "published",
				billing_mode: "one_time",
				interval: null,
				currency: "usd",
				price: 1000,
				credits: 10,
			},
			{
				plan_id: "p_disabled",
				status: "draft",
				billing_mode: "one_time",
				interval: null,
				currency: "usd",
				price: 2000,
				credits: 20,
			},
			{
				plan_id: "p_monthly",
				status: "published",
				billing_mode: "recurring",
				interval: "month",
				currency: "eur",
				price: 3000,
				credits: 30,
			},
		]);
	});
});

/**
 * S02 retires the platform payout ledger but must not lose a creator's Stripe
 * account identity. An old Express account becomes a `connected` account with
 * its real capabilities carried over — never silently upgraded to "ready".
 */
test("0002 carries connected accounts over and retires platform payouts", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, MIGRATIONS[0], MIGRATIONS[1]);
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES ('u1','Creator','c@example.test',true);
			INSERT INTO stripe_connect_accounts(id,user_id,stripe_account_id,account_type,status,charges_enabled,payouts_enabled,details_submitted,country,default_currency)
			VALUES
				('sca_ready','u1','acct_ready','express','active',true,true,true,'US','usd');
			INSERT INTO creator_payout_accounts(id,user_id) VALUES ('cpa1','u1');
		`);
		await apply(client, MIGRATIONS[2]);

		const { rows } = await client.query(
			"select user_id, stripe_account_id, onboarding_mode, status, dashboard_type, charges_enabled, payouts_enabled, requirements_currently_due from connected_accounts",
		);
		assert.deepEqual(rows, [
			{
				user_id: "u1",
				stripe_account_id: "acct_ready",
				onboarding_mode: "connected",
				status: "active",
				dashboard_type: "express",
				charges_enabled: true,
				payouts_enabled: true,
				requirements_currently_due: [],
			},
		]);

		// Retired platform payout tables and enums are gone.
		const { rows: tables } = await client.query(
			"select table_name from information_schema.tables where table_schema = 'public' and table_name in ('payouts','earnings_ledger','creator_payout_accounts','user_payout_preferences','stripe_connect_accounts')",
		);
		assert.deepEqual(tables, []);
		const { rows: enums } = await client.query(
			"select typname from pg_type where typname in ('payout_status','earnings_transaction_type','payout_method','payout_verification_status','stripe_connect_status')",
		);
		assert.deepEqual(enums, []);
	});
});

/**
 * S03 adds OAuth state and the flags that distinguish an authorized account
 * from a created one. Existing rows must never look OAuth-authorized, because
 * only an OAuth connection may be deauthorized at Stripe.
 */
test("0003 adds OAuth state without marking existing accounts as authorized", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, MIGRATIONS[0], MIGRATIONS[1], MIGRATIONS[2]);
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES ('u1','Creator','c@example.test',true);
			INSERT INTO connected_accounts(id,user_id,stripe_account_id,onboarding_mode,status,charges_enabled)
			VALUES ('ca1','u1','acct_created','created','active',true);
		`);
		await apply(client, MIGRATIONS[3]);

		const { rows } = await client.query(
			"select stripe_account_id, authorized_via_oauth, livemode from connected_accounts",
		);
		assert.deepEqual(rows, [
			{
				stripe_account_id: "acct_created",
				authorized_via_oauth: false,
				livemode: null,
			},
		]);

		// State is unique so a replayed callback cannot be stored twice.
		await client.query(
			"insert into connect_oauth_states(id,state_hash,user_id,expires_at) values ('s1','h1','u1', now() + interval '10 minutes')",
		);
		await assert.rejects(
			client.query(
				"insert into connect_oauth_states(id,state_hash,user_id,expires_at) values ('s2','h1','u1', now() + interval '10 minutes')",
			),
			/duplicate key/,
		);
	});
});

/**
 * S04 records the Stripe offer a published version sells. Existing published
 * rows have no Stripe references yet (they predate publication), so the columns
 * must stay nullable; the single-published index must still allow the one row
 * each plan already had.
 */
test("0004 adds publication references without breaking existing published rows", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(
			client,
			MIGRATIONS[0],
			MIGRATIONS[1],
			MIGRATIONS[2],
			MIGRATIONS[3],
		);
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES ('u1','Creator','c@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Pack');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,currency,price,credits,version,published_at)
			VALUES ('pv1','p1','u1','published','one_time','usd',1000,10,1,now());
		`);
		await apply(client, MIGRATIONS[4]);

		const {
			rows: [row],
		} = await client.query(
			"select status, published_at, unpublished_at, stripe_account_id, stripe_product_id, stripe_price_id from plan_versions where id = 'pv1'",
		);
		assert.equal(row.status, "published");
		assert.ok(row.published_at);
		assert.deepEqual(
			[
				row.unpublished_at,
				row.stripe_account_id,
				row.stripe_product_id,
				row.stripe_price_id,
			],
			[null, null, null, null],
		);

		// The database itself guarantees one current offer per plan.
		await assert.rejects(
			client.query(`
				INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,currency,price,credits,version,published_at)
				VALUES ('pv2','p1','u1','published','one_time','usd',2000,20,2,now());
			`),
			/duplicate key/,
		);
	});
});
