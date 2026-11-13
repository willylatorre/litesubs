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
	"drizzle/0005_s05_purchase.sql",
	"drizzle/0006_s06_credit_grants.sql",
	"drizzle/0007_s07_subscriptions.sql",
	"drizzle/0008_s08_renewals.sql",
	"drizzle/0009_s09_cancellation.sql",
	"drizzle/0010_s11_invites.sql",
	"drizzle/0011_s12_refunds.sql",
	"drizzle/0012_s15_disconnect.sql",
	"drizzle/0013_cal_booking_credits.sql",
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

/**
 * S05 adds the purchase pipeline. It is purely additive: existing enrollments
 * and ledger rows must be untouched, and `transactions.plan_version_id` starts
 * null because historical purchases predate version tracking.
 */
test("0005 adds purchase tables without disturbing existing ledger rows", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(
			client,
			MIGRATIONS[0],
			MIGRATIONS[1],
			MIGRATIONS[2],
			MIGRATIONS[3],
			MIGRATIONS[4],
		);
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES ('u1','Creator','c@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Pack');
			INSERT INTO enrollments(id,user_id,plan_id,creator_id,credits) VALUES ('e1','u1','p1','u1',7);
			INSERT INTO transactions(id,user_id,creator_id,plan_id,amount,type,status)
			VALUES ('t1','u1','u1','p1',10,'purchase','completed');
		`);
		await apply(client, MIGRATIONS[5]);

		// The historical row survives, with no invented version link.
		const {
			rows: [tx],
		} = await client.query(
			"select id, plan_id, plan_version_id from transactions",
		);
		assert.deepEqual(tx, { id: "t1", plan_id: "p1", plan_version_id: null });
		const {
			rows: [enrollment],
		} = await client.query("select credits from enrollments where id = 'e1'");
		assert.equal(enrollment.credits, 7);

		// One buyer is one Customer per creator, enforced by the database.
		await client.query(`
			INSERT INTO creator_customers(id,creator_id,user_id) VALUES ('cc1','u1','u1');
		`);
		await assert.rejects(
			client.query(
				"INSERT INTO creator_customers(id,creator_id,user_id) VALUES ('cc2','u1','u1')",
			),
			/duplicate key/,
		);
		// A Checkout session can back only one receipt.
		await client.query(`
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,currency,price,credits,version)
			VALUES ('pv1','p1','u1','draft','one_time','usd',1000,10,1);
			INSERT INTO payments(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_checkout_id,credits,amount_total,currency,application_fee)
			VALUES ('pay1','u1','u1','p1','pv1','acct_x','cs_1',10,1000,'usd',20);
		`);
		await assert.rejects(
			client.query(`
				INSERT INTO payments(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_checkout_id,credits,amount_total,currency,application_fee)
				VALUES ('pay2','u1','u1','p1','pv1','acct_x','cs_1',10,1000,'usd',20);
			`),
			/duplicate key/,
		);
	});
});

/**
 * S06 moves credits from a counter to grants. The backfill is the dangerous
 * part: if it misses an enrollment, that customer's paid credits become
 * unspendable the moment consumption starts allocating from grants.
 */
test("0006 backfills every existing balance into a spendable grant", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS.slice(0, 6));
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Buyer','b@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Pack'),('p2','u1','Empty');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,currency,price,credits,version,published_at)
			VALUES ('pv1','p1','u1','published','one_time','usd',1000,10,1,now());
			-- A zero-balance enrollment must not gain a phantom grant.
			INSERT INTO enrollments(id,user_id,plan_id,creator_id,credits) VALUES
				('e1','u2','p1','u1',7),
				('e2','u2','p2','u1',0);
			INSERT INTO transactions(id,user_id,creator_id,plan_id,plan_version_id,amount,type,status)
			VALUES ('t1','u2','u1','p1','pv1',10,'purchase','completed');
		`);
		await apply(client, MIGRATIONS[6]);

		// The balance becomes exactly one grant of the same size, linked to the
		// purchase that produced it.
		const {
			rows: [grant],
		} = await client.query(
			"select enrollment_id, kind, amount, remaining, expires_at, source_transaction_id, plan_version_id from credit_grants",
		);
		assert.deepEqual(grant, {
			enrollment_id: "e1",
			kind: "adjustment",
			amount: 7,
			remaining: 7,
			expires_at: null,
			source_transaction_id: "t1",
			plan_version_id: "pv1",
		});

		// Projection and grants agree, so nothing is stranded or invented.
		const { rows: totals } = await client.query(`
			select e.id, e.credits, coalesce(sum(g.remaining), 0)::int as granted
			from enrollments e
			left join credit_grants g on g.enrollment_id = e.id
			group by e.id, e.credits order by e.id
		`);
		assert.deepEqual(totals, [
			{ id: "e1", credits: 7, granted: 7 },
			{ id: "e2", credits: 0, granted: 0 },
		]);

		// The ledger keeps its shape; only the new type is added to the enum.
		const { rows: types } = await client.query(
			"select unnest(enum_range(null::transaction_type)) as t",
		);
		assert.ok(types.map((row) => row.t).includes("expiry"));
	});
});

test("0007 stores subscription receipts and prevents duplicate live subscriptions", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS);
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Buyer','b@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Monthly');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,interval,currency,price,credits,version)
			VALUES ('pv1','p1','u1','published','recurring','month','usd',2000,10,1);
			INSERT INTO subscriptions(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_customer_id,status,application_fee_percent)
			VALUES ('s1','u1','u2','p1','pv1','acct_test','cus_test','active',2);
		`);
		await assert.rejects(
			client.query(`
				INSERT INTO subscriptions(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_customer_id,status,application_fee_percent)
				VALUES ('s2','u1','u2','p1','pv1','acct_test','cus_test','pending',2);
			`),
			/duplicate key/,
		);
		await client.query(
			"UPDATE subscriptions SET status = 'canceled' WHERE id = 's1'",
		);
		await client.query(`
			INSERT INTO subscriptions(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_customer_id,status,application_fee_percent)
			VALUES ('s2','u1','u2','p1','pv1','acct_test','cus_test','pending',2);
			INSERT INTO subscription_invoices(id,subscription_id,stripe_account_id,stripe_invoice_id,amount_paid,currency,period_start,period_end,paid_at,credited_at)
			VALUES ('si1','s2','acct_test','in_first',0,'usd',now(),now() + interval '1 month',now(),now());
		`);
		await assert.rejects(
			client.query(`
				INSERT INTO subscription_invoices(id,subscription_id,stripe_account_id,stripe_invoice_id,amount_paid,currency,period_start,period_end,paid_at)
				VALUES ('si2','s2','acct_test','in_first',0,'usd',now(),now() + interval '1 month',now());
			`),
			/duplicate key/,
		);
	});
});

test("0008 keeps overdue subscriptions unique and a service period single-grant", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS);
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Buyer','b@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Monthly');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,interval,currency,price,credits,version)
			VALUES ('pv1','p1','u1','published','recurring','month','usd',2000,10,1);
			INSERT INTO subscriptions(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_customer_id,status,application_fee_percent)
			VALUES ('s1','u1','u2','p1','pv1','acct_test','cus_test','past_due',2);
		`);
		await assert.rejects(
			client.query(`
				INSERT INTO subscriptions(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_customer_id,status,application_fee_percent)
				VALUES ('s2','u1','u2','p1','pv1','acct_test','cus_test','pending',2);
			`),
			/duplicate key/,
		);
		await client.query(`
			INSERT INTO subscription_invoices(id,subscription_id,stripe_account_id,stripe_invoice_id,amount_paid,currency,period_start,period_end,paid_at)
			VALUES ('si1','s1','acct_test','in_1',2000,'usd','2026-01-01','2026-02-01',now());
		`);
		await assert.rejects(
			client.query(`
				INSERT INTO subscription_invoices(id,subscription_id,stripe_account_id,stripe_invoice_id,amount_paid,currency,period_start,period_end,paid_at)
				VALUES ('si2','s1','acct_test','in_2',2000,'usd','2026-01-01','2026-02-01',now());
			`),
			/duplicate key/,
		);
	});
});

test("0009 adds cancellation metadata without changing the paid period", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS.slice(0, 9));
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Buyer','b@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Monthly');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,interval,currency,price,credits,version)
			VALUES ('pv1','p1','u1','published','recurring','month','usd',2000,10,1);
			INSERT INTO subscriptions(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_customer_id,status,application_fee_percent,paid_through_at)
			VALUES ('s1','u1','u2','p1','pv1','acct_test','cus_test','active',2,'2026-12-01T00:00:00Z');
		`);
		await apply(client, MIGRATIONS[9]);
		const {
			rows: [row],
		} = await client.query(
			"select cancel_at_period_end, cancel_at, cancellation_revision, paid_through_at from subscriptions where id = 's1'",
		);
		assert.deepEqual(row, {
			cancel_at_period_end: false,
			cancel_at: null,
			cancellation_revision: 0,
			paid_through_at: new Date("2026-12-01T00:00:00.000Z"),
		});
	});
});

test("0010 stores the issued offer and comp expiry on invites", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS.slice(0, 10));
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Monthly');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,interval,currency,price,credits,version)
			VALUES ('pv1','p1','u1','published','recurring','month','usd',2000,10,1);
			INSERT INTO invites(id,creator_id,email,plan_id,token)
			VALUES ('i1','u1','b@example.test','p1','token-1');
		`);
		await apply(client, MIGRATIONS[10]);
		const {
			rows: [row],
		} = await client.query(
			"select plan_version_id, comp_expires_at from invites where id = 'i1'",
		);
		assert.deepEqual(row, { plan_version_id: null, comp_expires_at: null });
		await client.query(
			"UPDATE invites SET plan_version_id = 'pv1', comp_expires_at = '2026-12-01T00:00:00Z' WHERE id = 'i1'",
		);
		const {
			rows: [updated],
		} = await client.query(
			"select plan_version_id, comp_expires_at from invites where id = 'i1'",
		);
		assert.deepEqual(updated, {
			plan_version_id: "pv1",
			comp_expires_at: new Date("2026-12-01T00:00:00.000Z"),
		});
	});
});

test("0011 adds refund receipts without storing a refund as new credits", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS.slice(0, 11));
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Buyer','b@example.test',true);
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Pack');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,currency,price,credits,version)
			VALUES ('pv1','p1','u1','published','one_time','usd',1000,10,1);
			INSERT INTO payments(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,status,credits,amount_total,currency,application_fee,amount_paid)
			VALUES ('pay1','u1','u2','p1','pv1','acct_test','paid',10,1000,'usd',20,1000);
		`);
		await apply(client, MIGRATIONS[11]);
		const {
			rows: [payment],
		} = await client.query(
			"select amount_refunded, refunded_at from payments where id = 'pay1'",
		);
		assert.deepEqual(payment, { amount_refunded: 0, refunded_at: null });
		await client.query(`
			INSERT INTO refunds(id,payment_id,creator_id,user_id,stripe_account_id,stripe_refund_id,amount,currency,revoked_credits)
			VALUES ('r1','pay1','u1','u2','acct_test','re_1',400,'usd',0);
		`);
		// A refund above the recorded payment is refused by the constraint.
		await assert.rejects(
			client.query(`
				UPDATE payments SET amount_refunded = 1200 WHERE id = 'pay1';
			`),
			/check constraint/,
		);
	});
});

/**
 * S15 records why renewals stopped and whether a disconnect attempt failed.
 * Existing subscriptions predate the distinction, so the cause must stay null
 * instead of being backfilled into a customer cancellation.
 */
test("0012 records a cancellation cause without relabelling existing subscriptions", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS.slice(0, 12));
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Buyer','b@example.test',true);
			INSERT INTO connected_accounts(id,user_id,stripe_account_id,onboarding_mode,status)
			VALUES ('ca1','u1','acct_test','connected','active');
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Monthly');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,interval,currency,price,credits,version)
			VALUES ('pv1','p1','u1','published','recurring','month','usd',2000,12,1);
			INSERT INTO subscriptions(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,stripe_customer_id,status,application_fee_percent,cancel_at_period_end)
			VALUES ('s1','u1','u2','p1','pv1','acct_test','cus_test','active',2,false);
		`);
		await apply(client, MIGRATIONS[12]);

		const {
			rows: [subscription],
		} = await client.query(
			"select cancellation_cause from subscriptions where id = 's1'",
		);
		assert.deepEqual(subscription, { cancellation_cause: null });
		const {
			rows: [account],
		} = await client.query(
			"select disconnect_failure, disconnect_attempted_at from connected_accounts where id = 'ca1'",
		);
		assert.deepEqual(account, {
			disconnect_failure: null,
			disconnect_attempted_at: null,
		});

		// The enum rejects an invented cause rather than accepting free text.
		await assert.rejects(
			client.query(
				"UPDATE subscriptions SET cancellation_cause = 'platform' WHERE id = 's1'",
			),
			/invalid input value/,
		);
		await client.query(
			"UPDATE subscriptions SET cancellation_cause = 'creator_disconnect' WHERE id = 's1'",
		);
	});
});

/**
 * S15 part two: booking credits. An existing event type must keep working as a
 * free booking link (the price is nullable), and the booking uid must be unique
 * so a replayed Cal.com delivery cannot become a second debit.
 */
test("0013 adds booking credit pricing without charging existing event types", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
	await withFreshDatabase(async (client) => {
		await apply(client, ...MIGRATIONS.slice(0, 13));
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES
				('u1','Creator','c@example.test',true),
				('u2','Buyer','b@example.test',true);
			INSERT INTO calcom_integrations(id,event_type_id,event_type_name)
			VALUES ('cal1',4242,'Coaching call');
			INSERT INTO plans(id,creator_id,name) VALUES ('p1','u1','Coaching');
			INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,currency,price,credits,version)
			VALUES ('pv1','p1','u1','published','one_time','usd',10000,10,1);
			INSERT INTO enrollments(id,user_id,plan_id,creator_id,credits) VALUES ('e1','u2','p1','u1',10);
		`);
		await apply(client, MIGRATIONS[13]);

		// A pre-existing booking link does not start charging people by surprise.
		const {
			rows: [integration],
		} = await client.query(
			"select credits_per_booking from calcom_integrations where id = 'cal1'",
		);
		assert.deepEqual(integration, { credits_per_booking: null });

		await client.query(`
			INSERT INTO cal_bookings(id,booking_uid,creator_id,user_id,plan_id,enrollment_id,calcom_integration_id,charged_credits)
			VALUES ('b1','bk_1','u1','u2','p1','e1','cal1',3);
		`);
		// The booking uid is the idempotency boundary for webhook retries.
		await assert.rejects(
			client.query(`
				INSERT INTO cal_bookings(id,booking_uid,creator_id,user_id,plan_id,enrollment_id,charged_credits)
				VALUES ('b2','bk_1','u1','u2','p1','e1',3);
			`),
			/duplicate key/,
		);
		// A booking cannot claim a negative charge, and a price must be positive.
		await assert.rejects(
			client.query(
				"UPDATE cal_bookings SET charged_credits = -1 WHERE id = 'b1'",
			),
			/check constraint/,
		);
		await assert.rejects(
			client.query(
				"UPDATE calcom_integrations SET credits_per_booking = 0 WHERE id = 'cal1'",
			),
			/check constraint/,
		);
	});
});
