import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";

config({ path: [".env.local", ".env"] });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
	await client.connect();
	const { rows: [tables] } = await client.query("select to_regclass('public.user') as users, to_regclass('drizzle.__drizzle_migrations') as journal");
	if (tables.users) {
		const baseline = await readFile(new URL("../drizzle/0000_init.sql", import.meta.url), "utf8");
		const hash = createHash("sha256").update(baseline).digest("hex");
		const applied = tables.journal ? await client.query("select id from drizzle.__drizzle_migrations where hash = $1", [hash]) : { rows: [] };
		if (!applied.rows.length) throw new Error("This database predates the squashed baseline. Point DATABASE_URL at a fresh database before migrating. No database was reset.");
	}
} finally {
	await client.end();
}
