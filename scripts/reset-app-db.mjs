import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import pg from "pg";

// This is a deliberately manual release operation, not an application startup
// hook. No schema is reset without an explicit confirmation argument.
if (!process.argv.includes("--confirm-reset")) {
	throw new Error("Refusing reset. This removes Litesubs accounts and data. Pass --confirm-reset only after explicit approval.");
}
if (!process.env.DATABASE_URL) {
	createRequire(import.meta.url)("dotenv").config({ path: [".env.local", ".env"] });
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const refIndex = process.argv.indexOf("--baseline-ref");
const releaseRef = refIndex < 0 ? null : process.argv[refIndex + 1];
if (refIndex >= 0 && !/^[a-f0-9]{40}$/.test(releaseRef ?? "")) throw new Error("--baseline-ref requires an immutable full commit SHA");
async function artifact(path) {
	if (!releaseRef) return readFile(path, "utf8");
	const response = await fetch(`https://raw.githubusercontent.com/willylatorre/litesubs/${releaseRef}/${path}`);
	if (!response.ok) throw new Error(`Could not retrieve approved baseline artifact (${response.status})`);
	return response.text();
}
const baseline = await artifact("drizzle/0000_init.sql");
const journal = JSON.parse(await artifact("drizzle/meta/_journal.json"));
if (journal.entries.length !== 1 || journal.entries[0].tag !== "0000_init") {
	throw new Error("Reset only supports the approved single 0000_init baseline.");
}
const hash = createHash("sha256").update(baseline).digest("hex");
const tables = [...baseline.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(match => match[1]);
const enums = [...baseline.matchAll(/CREATE TYPE "public"\."([a-z_]+)"/g)].map(match => match[1]);
if (tables.length !== 25 || !tables.includes("user") || !enums.length) throw new Error("Unexpected baseline; inspect it before resetting.");
const appTables = [...tables, "user_balances"];
const quote = name => `"${name}"`;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis:10000 });
let hasJournal = false;
try {
	await client.connect();
	const { rows: [existingJournal] } = await client.query("select to_regclass('drizzle.__drizzle_migrations') as name");
	hasJournal = Boolean(existingJournal.name);
	if (existingJournal.name) {
		const { rows } = await client.query("select id from drizzle.__drizzle_migrations where hash = $1", [hash]);
		if (rows.length) {
			console.log("Approved baseline already applied; no reset performed.");
			process.exitCode = 0;
		} else await reset();
	} else await reset();
} finally { await client.end(); }

async function reset() {
	await client.query("BEGIN");
	try {
		await client.query("SET LOCAL lock_timeout = '30s'");
		await client.query("SET LOCAL statement_timeout = '120s'");
		const { rows: existing } = await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_name = ANY($1)", [appTables]);
		const names = existing.map(row => row.table_name);
		if (names.length) {
			await client.query(`LOCK TABLE ${names.map(name => `public.${quote(name)}`).join(", ")} IN ACCESS EXCLUSIVE MODE`);
			const backup = `litesubs_backup_${Date.now()}`;
			await client.query(`CREATE SCHEMA ${quote(backup)}`);
			await client.query(`REVOKE ALL ON SCHEMA ${quote(backup)} FROM PUBLIC`);
			for (const name of names) {
				// JSON removes enum/foreign-key dependencies on the old schema.
				await client.query(`CREATE TABLE ${quote(backup)}.${quote(name)} AS SELECT to_jsonb(source) AS data FROM public.${quote(name)} source`);
			}
			if (hasJournal) await client.query(`CREATE TABLE ${quote(backup)}.migration_history AS SELECT to_jsonb(source) AS data FROM drizzle.__drizzle_migrations source`);
			console.log(`App-only data snapshot created in ${backup}; managed Supabase schemas are untouched.`);
		}
		// Never CASCADE: a dependency outside this explicit app-table list must
		// fail and roll back, rather than remove managed schemas or foreign data.
		await client.query(`DROP TABLE IF EXISTS ${appTables.map(name => `public.${quote(name)}`).join(", ")}`);
		await client.query(`DROP TYPE IF EXISTS ${enums.map(name => `public.${quote(name)}`).join(", ")}`);
		await client.query("DROP TABLE IF EXISTS drizzle.__drizzle_migrations");
		await client.query(baseline);
		// These tables are served through Next/Beter Auth, not anonymously
		// through Supabase PostgREST. Do not inherit broad default table grants.
		const { rows: roles } = await client.query("select rolname from pg_roles where rolname in ('anon', 'authenticated')");
		await client.query(`REVOKE ALL ON TABLE ${tables.map(name => `public.${quote(name)}`).join(", ")} FROM PUBLIC${roles.length ? `, ${roles.map(role => quote(role.rolname)).join(", ")}` : ""}`);
		await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
		await client.query("CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
		await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [hash, journal.entries[0].when]);
		await client.query("COMMIT");
		console.log(`Applied 0000_init (${tables.length} app tables). Litesubs starts empty.`);
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}
