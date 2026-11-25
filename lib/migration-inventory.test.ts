/**
 * The migration journal, the SQL files, the snapshots, and the hardcoded list in
 * `lib/migrations.test.ts` all describe the same history. They drifted once
 * already: eight journal entries have no snapshot, one snapshot that exists
 * describes a schema no SQL file ever produced, and the test's own `MIGRATIONS`
 * array is a fourth copy that nothing checked.
 *
 * These tests fail on that drift rather than on the migration content. They read
 * files only, so they run offline in the normal `npm test`.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

type Journal = {
	entries: Array<{ idx: number; version: string; when: number; tag: string }>;
};

const journal = JSON.parse(
	readFileSync("drizzle/meta/_journal.json", "utf8"),
) as Journal;

const sqlFiles = readdirSync("drizzle")
	.filter((name) => name.endsWith(".sql"))
	.sort();

const snapshotFiles = readdirSync("drizzle/meta")
	.filter((name) => name.endsWith("_snapshot.json"))
	.sort();

/**
 * Every journal entry must have its SQL file, and no SQL file may be orphaned.
 * `drizzle-orm`'s migrator throws on a missing file but silently ignores an
 * extra one, so an orphan means a migration someone wrote and never applied.
 */
test("every journal entry has a SQL file and no SQL file is orphaned", () => {
	const journalTags = journal.entries.map((entry) => entry.tag);
	const sqlTags = sqlFiles.map((name) => name.replace(/\.sql$/, ""));

	assert.deepEqual(
		sqlTags,
		journalTags,
		"drizzle/*.sql and drizzle/meta/_journal.json disagree. A journal entry with no file aborts every migrate; a file with no entry is never applied.",
	);
});

/** Indices must be dense and ordered, or the migrator's bookkeeping is wrong. */
test("journal indices are dense and match entry order", () => {
	journal.entries.forEach((entry, position) => {
		assert.equal(
			entry.idx,
			position,
			`${entry.tag} is at position ${position} but claims idx ${entry.idx}`,
		);
	});
});

/**
 * A gap in the journal's `when` timestamps makes the migrator skip entries on a
 * database whose recorded time is between them. The runtime warns; this fails.
 */
test("journal timestamps strictly increase", () => {
	for (let i = 1; i < journal.entries.length; i += 1) {
		const previous = journal.entries[i - 1];
		const entry = journal.entries[i];
		assert.ok(
			entry.when > previous.when,
			`${entry.tag} (${entry.when}) is not newer than ${previous.tag} (${previous.when})`,
		);
	}
});

/**
 * Snapshots are the *input* to `drizzle-kit generate`: the newest snapshot is the
 * `prev` side of the next diff. A journal entry with no snapshot is not
 * harmless — the next `generate` diffs against an older schema and re-emits
 * changes that already shipped.
 *
 * This asserts the exact gap that exists today, so closing it fails the test and
 * the new state is recorded deliberately rather than discovered later.
 */
test("the snapshot gap is exactly the documented set", () => {
	const snapshotPrefixes = new Set(
		snapshotFiles.map((name) => name.slice(0, 4)),
	);
	const missing = journal.entries
		.filter((entry) => !snapshotPrefixes.has(entry.tag.slice(0, 4)))
		.map((entry) => entry.tag);

	assert.deepEqual(missing, [
		"0015_split_calendars",
		"0016_remove_calcom",
		"0018_drop_bookings",
		"0019_drop_commission",
		"0020_creator_entitlements",
		"0021_platform_billing",
		"0022_platform_paid_through",
		"0023_platform_paid_through_checked",
	]);
});

/** A snapshot with no journal entry is dead weight that confuses `generate`. */
test("every snapshot belongs to a journal entry", () => {
	const journalPrefixes = new Set(
		journal.entries.map((entry) => entry.tag.slice(0, 4)),
	);
	for (const name of snapshotFiles) {
		assert.ok(
			journalPrefixes.has(name.slice(0, 4)),
			`drizzle/meta/${name} has no journal entry`,
		);
	}
});

/**
 * Snapshots form a chain: each `prevId` must be the previous snapshot's `id`.
 * A detached snapshot means `generate` diffs against a schema that is not in this
 * repository's history at all.
 */
test("snapshot parent ids form an unbroken chain", () => {
	const chain = snapshotFiles.map((name) => {
		const snapshot = JSON.parse(
			readFileSync(`drizzle/meta/${name}`, "utf8"),
		) as { id: string; prevId: string };
		return { name, id: snapshot.id, prevId: snapshot.prevId };
	});

	// 0014 is detached: its parent id appears nowhere in the tree. The assertion
	// records that as a known defect instead of pretending the chain is intact.
	const detached: string[] = [];
	for (let i = 1; i < chain.length; i += 1) {
		const previous = chain[i - 1];
		const current = chain[i];
		if (current.prevId !== previous.id) {
			detached.push(
				`${current.name} expects parent ${current.prevId.slice(0, 8)} but ${previous.name} is ${previous.id.slice(0, 8)}`,
			);
		}
	}

	assert.deepEqual(detached, [
		"0014_snapshot.json expects parent b78c470d but 0013_snapshot.json is 7413f0a3",
	]);
});
