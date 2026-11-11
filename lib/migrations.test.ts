/**
 * The additive 0001 migration must preserve every existing row. This runs the
 * real baseline + migration against a throwaway database, so a future edit that
 * drops or recreates a table fails here instead of on a deployment.
 *
 * Opt-in: set MIGRATION_TEST_DATABASE_URL to a disposable PostgreSQL database
 * the test may drop and recreate. Skipped otherwise so `npm test` stays offline.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";

test("0001 renames credit tables without losing rows", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
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
		for (const file of [
			"drizzle/0000_init.sql",
			"drizzle/0001_plans_enrollments.sql",
		])
			await client.query(await readFile(file, "utf8"));

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
	} finally {
		await client.end();
		const cleanup = new pg.Client({ connectionString: adminUrl.toString() });
		await cleanup.connect();
		await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}"`);
		await cleanup.end();
	}
});

/**
 * Terms are backfilled from the pre-migration columns. A published plan keeps
 * selling its old price; a disabled one becomes a draft, never a silent price
 * change or a resurrected offer.
 */
test("0001 backfills published and draft terms from the old columns", {
	skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async () => {
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
		await client.query(await readFile("drizzle/0000_init.sql", "utf8"));
		await client.query(`
			INSERT INTO "user"(id,name,email,email_verified) VALUES ('u1','Creator','c@example.test',true);
			INSERT INTO products(id,creator_id,name,price,credits,currency,type,active) VALUES
				('p_active','u1','Active pack',1000,10,'usd','one_time',true),
				('p_disabled','u1','Disabled pack',2000,20,'usd','one_time',false),
				('p_monthly','u1','Monthly',3000,30,'eur','recurring',true);
		`);
		await client.query(
			await readFile("drizzle/0001_plans_enrollments.sql", "utf8"),
		);

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
	} finally {
		await client.end();
		const cleanup = new pg.Client({ connectionString: adminUrl.toString() });
		await cleanup.connect();
		await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}"`);
		await cleanup.end();
	}
});
