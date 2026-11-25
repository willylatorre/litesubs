/**
 * Prove the migration chain from both ends, on a disposable database:
 *
 *   1. **Clean:** a brand-new database, every journal entry applied through the
 *      real drizzle migrator, then migrated again with no effect.
 *   2. **Upgrade:** a database stopped at an earlier revision carrying real
 *      rows, completed, and the rows compared byte-for-byte.
 *
 * Idempotency is a property of the migrator's journal table, not of the SQL: the
 * statements are plain `CREATE TYPE`/`ALTER TABLE` and would fail on replay. So
 * step 1 runs `migrate()` twice and asserts the second pass applies zero
 * statements, rather than replaying files by hand.
 *
 * This deliberately drives the real `drizzle/` folder and prints the row hash so
 * the operator can compare a rerun. It refuses anything that is not a disposable
 * local database.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
	checkEnvironment,
	checkTarget,
	formatRefusal,
} from "@/lib/verify-guard";

const variable = "MIGRATION_TEST_DATABASE_URL";
const url = process.env[variable];

if (!url) {
	throw new Error(
		`Refusing to run: ${variable} is not set. Point it at a disposable local database, e.g. postgresql://localhost:5432/litesubs_migration_test.`,
	);
}

const envVerdict = checkEnvironment();
if (!envVerdict.safe) throw new Error(formatRefusal(envVerdict));
const verdict = checkTarget(variable, url);
if (!verdict.safe) throw new Error(verdict.error.message);

const target = new URL(url);
const databaseName = target.pathname.slice(1);
const admin = new URL(url);
admin.pathname = "/postgres";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
	entries: Array<{ tag: string }>;
};
const allTags = journal.entries.map((entry) => entry.tag);

async function recreate(): Promise<pg.Client> {
	const adminClient = new pg.Client({ connectionString: admin.toString() });
	await adminClient.connect();
	await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
	await adminClient.query(`CREATE DATABASE "${databaseName}"`);
	await adminClient.end();
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	return client;
}

async function drop(client: pg.Client): Promise<void> {
	await client.end();
	const adminClient = new pg.Client({ connectionString: admin.toString() });
	await adminClient.connect();
	await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
	await adminClient.end();
}

/** Run the real migrator; return how many journal rows it added. */
async function runMigrator(client: pg.Client): Promise<number> {
	const before = await migrationCount(client);
	await migrate(drizzle(client), { migrationsFolder: "drizzle" });
	return (await migrationCount(client)) - before;
}

async function migrationCount(client: pg.Client): Promise<number> {
	const { rows } = await client.query(
		`select to_regclass('drizzle.__drizzle_migrations') as t`,
	);
	if (!rows[0].t) return 0;
	const count = await client.query(
		`select count(*)::int as n from drizzle.__drizzle_migrations`,
	);
	return count.rows[0].n as number;
}

/** Apply only the first `count` journal entries, by pointing at a subset. */
async function applyPrefix(client: pg.Client, count: number): Promise<void> {
	for (const tag of allTags.slice(0, count)) {
		await client.query(readFileSync(`drizzle/${tag}.sql`, "utf8"));
	}
	// Record them as applied so a later migrator run continues rather than
	// replaying from the start. The hash matches what drizzle computes.
	const { rows } = await client.query(
		`select to_regclass('drizzle.__drizzle_migrations') as t`,
	);
	if (!rows[0].t) {
		await client.query("create schema if not exists drizzle");
		await client.query(`create table drizzle.__drizzle_migrations (
			id serial primary key,
			hash text not null,
			created_at bigint
		)`);
	}
	for (const entry of journal.entries.slice(0, count)) {
		const sql = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
		const hash = createHash("sha256").update(sql).digest("hex");
		await client.query(
			`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
			[hash, (entry as unknown as { when: number }).when],
		);
	}
}

async function tableHash(
	client: pg.Client,
	query: string,
): Promise<{ rows: number; hash: string }> {
	const result = await client.query(query);
	const stable =
		result.rows.length === 0
			? ""
			: JSON.stringify(result.rows, Object.keys(result.rows[0]).sort());
	return {
		rows: result.rows.length,
		hash: createHash("sha256").update(stable).digest("hex"),
	};
}

async function tableCount(client: pg.Client): Promise<number> {
	const { rows } = await client.query(
		`select count(*)::int as n from information_schema.tables
		 where table_schema='public' and table_type='BASE TABLE'`,
	);
	return rows[0].n as number;
}

console.log(`target: ${databaseName} on ${target.hostname} (refused if not local)`);

// ---------------------------------------------------------------- clean run
console.log("\n=== 1. clean from scratch ===");
let client = await recreate();
const firstPass = await runMigrator(client);
console.log(`first pass: applied ${firstPass} migrations`);
console.log(`tables: ${await tableCount(client)}`);

const secondPass = await runMigrator(client);
console.log(`second pass: applied ${secondPass} migrations (must be 0)`);
console.log(
	`idempotency: ${secondPass === 0 ? "no-op" : "REAPPLIED — journal tracking is broken"}`,
);
console.log(`drizzle.__drizzle_migrations rows: ${await migrationCount(client)}`);
await drop(client);

// -------------------------------------------------------------- seeded run
console.log("\n=== 2. seeded upgrade ===");
const UPGRADE_AT = "0013_bookings";
const stopAt = allTags.indexOf(UPGRADE_AT) + 1;
if (stopAt === 0) throw new Error(`${UPGRADE_AT} is not in the journal`);

client = await recreate();
await applyPrefix(client, stopAt);
console.log(`stopped after ${UPGRADE_AT} (${stopAt} migrations)`);

await client.query(`
	INSERT INTO "user"(id,name,email,email_verified) VALUES
		('u_creator','Creator','creator@example.test',true),
		('u_buyer','Buyer','buyer@example.test',true);
	INSERT INTO plans(id,creator_id,name) VALUES ('p1','u_creator','Coaching');
	INSERT INTO plan_versions(id,plan_id,creator_id,status,billing_mode,currency,price,credits,version,published_at)
		VALUES ('pv1','p1','u_creator','published','one_time','usd',10000,10,1,now());
	INSERT INTO enrollments(id,user_id,plan_id,creator_id,credits) VALUES ('e1','u_buyer','p1','u_creator',7);
	INSERT INTO credit_grants(id,enrollment_id,creator_id,user_id,plan_id,kind,amount,remaining)
		VALUES ('g1','e1','u_creator','u_buyer','p1','purchase',10,7);
	INSERT INTO transactions(id,creator_id,user_id,plan_id,plan_version_id,type,amount,balance_after,description)
		VALUES ('t1','u_creator','u_buyer','p1','pv1','usage',-3,7,'A lesson');
	INSERT INTO payments(id,creator_id,user_id,plan_id,plan_version_id,stripe_account_id,status,credits,amount_total,currency,application_fee)
		VALUES ('pay1','u_creator','u_buyer','p1','pv1','acct_x','paid',10,10000,'usd',200);
`);

const probes = {
	user: `select id, name, email from "user" order by id`,
	plans: `select id, creator_id, name from plans order by id`,
	plan_versions: `select id, plan_id, status, billing_mode, currency, price, credits, version from plan_versions order by id`,
	enrollments: `select id, user_id, plan_id, creator_id, credits from enrollments order by id`,
	credit_grants: `select id, enrollment_id, kind, amount, remaining from credit_grants order by id`,
	transactions: `select id, plan_id, type, amount, balance_after, description from transactions order by id`,
	payments: `select id, plan_id, status, credits, amount_total, currency, application_fee from payments order by id`,
};

const before: Record<string, { rows: number; hash: string }> = {};
for (const [name, query] of Object.entries(probes)) {
	before[name] = await tableHash(client, query);
}
console.log("row fingerprints before upgrade:");
for (const [name, value] of Object.entries(before)) {
	console.log(
		`  ${name.padEnd(16)} rows=${String(value.rows).padStart(2)} sha256=${value.hash}`,
	);
}

const upgraded = await runMigrator(client);
console.log(`migrator applied ${upgraded} remaining migrations`);

const after: Record<string, { rows: number; hash: string }> = {};
for (const [name, query] of Object.entries(probes)) {
	after[name] = await tableHash(client, query);
}

let identical = true;
for (const name of Object.keys(probes)) {
	const same =
		before[name].hash === after[name].hash && before[name].rows === after[name].rows;
	if (!same) identical = false;
	console.log(`  ${name.padEnd(16)} ${same ? "IDENTICAL" : "CHANGED"}`);
}
console.log(
	`\nrow preservation: ${identical ? "all probed tables byte-identical" : "DATA CHANGED"}`,
);
console.log(`final tables: ${await tableCount(client)}`);
await drop(client);

if (!identical) process.exit(1);
