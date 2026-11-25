# Verification

What actually runs here, what passes today, and what is broken. This is a
baseline recorded on 2026-11-25 against `fc2cbca`, not a promise that the gates
are green. Where something fails, the failure is stated.

## Commands

Run from the repository root. Node `>=24`, npm (the lockfile is npm's).

| Command | What it proves | Needs a database |
| --- | --- | --- |
| `npm test` | 143 unit cases; every database suite skips itself | no |
| `npx tsc --noEmit` | types | no |
| `npm run check` | Biome lint + format | no |
| `MIGRATION_TEST_DATABASE_URL=… npm run verify:migrations` | clean migrate, idempotent re-run, seeded upgrade | yes |
| `npm run db:migrate` | applies the journal to `DATABASE_URL` | yes |
| `NODE_ENV=production npm run build` | the app builds | no |

`npm run check` is **not green**: 183 errors and 18 warnings pre-date this task
(mostly `assist/source/organizeImports` and `app/globals.css`'s Tailwind
directives being unparsable without a parser option). The count is recorded so a
later change can be compared against it rather than against zero. Files added
here are formatted and lint-clean.

## The disposable-database run

Integration and migration tests are opt-in and skip without a database. The
full set needs **two** files, not one — this is the first trap:

```sh
set -a; . ./.env; . ./.env.test; set +a
npm test
```

`.env.test` supplies `DATABASE_URL`, `MCP_TEST_DATABASE_URL` and
`MIGRATION_TEST_DATABASE_URL`; `.env` supplies `BETTER_AUTH_URL`. Loading only
`.env.test` fails three suites with `TypeError: Invalid URL` from better-auth's
OAuth provider, because the plugin builds a URL from an empty issuer. See
[README](../README.md#integration-tests).

Measured on 2026-11-25, disposable local Postgres:

- both env files loaded: **220 tests, 220 pass, 0 fail, 0 skipped**
- `.env.test` only: **220 tests, 216 pass, 4 fail** — all four are the
  `Invalid URL` issuer error, not application defects

`MIGRATION_TEST_DATABASE_URL` must name its own database. Its suite runs
`DROP DATABASE` and `CREATE DATABASE` for every case.

## Safe-target guard

`lib/verify-guard.ts` refuses a destructive run against anything that is not a
local disposable database. It is wired in twice:

- `npm test` runs `scripts/verify-targets.mts` as a pre-flight, so a refusal is
  one clear sentence and a non-zero exit;
- the same module is preloaded via `tsx --import`, so
  `tsx --test lib/migrations.test.ts` typed by hand is refused too. A suite added
  later cannot forget to call it.

It refuses when:

- the host is not loopback (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`);
- the database name carries no disposable marker (`test`, `verify`, `scratch`,
  `migration`, …) — this catches an SSH tunnel to a real database, which presents
  as `localhost`;
- the name carries an environment marker (`prod`, `live`, `main`, `primary`);
- `MIGRATION_TEST_DATABASE_URL` equals `DATABASE_URL`.

`MCP_TEST_DATABASE_URL === DATABASE_URL` is **allowed**, deliberately: the
integration suites assert that equality in sixteen places and both CI and the
README set it that way. It is not the dangerous pair — those suites share rows,
they do not drop the database. A shared value still has to pass the host and name
checks, so a production `DATABASE_URL` copied into it is refused.

The refusal is an error, never a silent skip. `lib/verify-guard.test.ts` covers
the cases, including the one that matters most:
`postgresql://user@db.example.com/prod` must be refused.

`npm run db:migrate` is deliberately **not** behind this guard. It is the deploy
path — `.github/workflows/drizzle-migrate.yml` runs it against production through
a secret — so it must accept a remote host. It keeps its own narrower protection
(`scripts/check-migration-baseline.mjs`), which refuses a database that has a
`user` table but no recorded baseline migration.

## Migration inventory

`drizzle/meta/_journal.json` has 24 entries and all 24 `.sql` files exist. Only
16 snapshots do. The gap is not cosmetic: **the newest snapshot is `0017`, so every
future `drizzle-kit generate` diffs against `0017`**, while the database has
already applied `0018`–`0023`.

| Journal entry | SQL | Snapshot | Consequence |
| --- | --- | --- | --- |
| `0000_init` … `0013_bookings` | yes | yes | consistent |
| `0014_outgoing_webhooks` | yes | yes | **stale**: describes Cal.com tables, not what the SQL creates |
| `0015_split_calendars` | yes | **no** | not in `generate`'s diff base |
| `0016_remove_calcom` | yes | **no** | not in `generate`'s diff base |
| `0017_usernames` | yes | yes | newest snapshot — the diff base |
| `0018_drop_bookings` | yes | **no** | booking-table drops invisible to `generate` |
| `0019_drop_commission` | yes | **no** | fee-constraint change invisible to `generate` |
| `0020_creator_entitlements` | yes | **no** | `creator_tier` enum invisible to `generate` |
| `0021_platform_billing` | yes | **no** | `litesub_subscription` invisible to `generate` |
| `0022_platform_paid_through` | yes | **no** | `paid_through_at` invisible to `generate` |
| `0023_platform_paid_through_checked` | yes | **no** | `paid_through_checked_at` invisible to `generate` |

Measured, not inferred:

- `drizzle-kit migrate` reads only `_journal.json` and `<tag>.sql`
  (`drizzle-orm/migrator.js`), so **migration itself is unaffected** by the
  missing snapshots.
- `drizzle-kit check` exits 0. It never compares journal entries to SQL files:
  deleting two `.sql` files from a copy still printed `Everything's fine`. It only
  validates snapshot JSON, parent-id collisions, and journal timestamp order.
- `drizzle-kit generate` **fails** on this tree. Diffing `0017` against the current
  schema produces both created and deleted enums, which drizzle-kit cannot tell
  apart from renames, so it opens an interactive prompt and aborts:
  `Interactive prompts require a TTY terminal`.
- Diffing `0017` against the current schema would want to drop
  `cal_bookings`, `cal_com_accounts`, `calcom_integrations`, `integrations` and
  `integration_type`, and create `litesub_subscription` and `creator_tier` — all of
  which are already handled by `0018`–`0023`. A generated migration would be
  wrong.

Two further defects, both invisible to `check`:

- `0014_snapshot.json`'s `prevId` (`b78c470d…`) is the `id` of no snapshot in the
  tree; the chain breaks there.
- `0014_snapshot.json` and `0017_snapshot.json` both list `cal_bookings`, a table
  no migration ever created. The `0013` snapshot has the real `bookings` tables.

### What this means

`generate` is unusable until the snapshots are repaired. The fix is to
regenerate snapshots for `0015`–`0023` from the schema and the applied SQL, which
is a migration-history change and therefore **not** done here — see
[REFOCUS](../docs/REFOCUS.md) and the T065 handoff. Until then:

- apply migrations with `npm run db:migrate`, never `generate`;
- do not delete `0014`/`0017`, even though they are wrong: they are the only diff
  base that exists;
- `lib/migration-inventory.test.ts` pins the current gap exactly. Repairing it
  will fail that test, which is the point — the new state gets recorded on
  purpose instead of drifting again.

## Clean and seeded proofs

`npm run verify:migrations` runs both against `MIGRATION_TEST_DATABASE_URL` and
prints a hash per table so two runs can be compared.

Clean from scratch, 2026-11-25:

```
first pass: applied 24 migrations
tables: 32
second pass: applied 0 migrations (must be 0)
idempotency: no-op
drizzle.__drizzle_migrations rows: 24
```

Idempotency comes from the journal table, not from the SQL: the statements are
plain `CREATE TYPE`/`ALTER TABLE` and fail if replayed by hand. The script
therefore calls the real migrator twice rather than executing files.

Seeded upgrade — stopped after `0013_bookings`, inserted a user, buyer, plan,
published version, enrollment, grant, ledger row and payment, then applied the
rest. Every probed table was byte-identical after the upgrade:

```
  user             rows= 2 sha256=230ecaaa23fdc28ec6de758f014a50f3e1479c00a314fa68b651986f4fda378f
  plans            rows= 1 sha256=0aa388e1ae381b34564808c5883a9288a2f3806a4bb66281914297d87bc5989d
  plan_versions    rows= 1 sha256=2664629ee5ad5af18c91bef469ead9071d989702ecfd7274600dcae263107cf3
  enrollments      rows= 1 sha256=faa4941f49d22b183e09d339e0cf9bdf5868b1f8f767901c1736a63f3c5c49a4
  credit_grants    rows= 1 sha256=2ed8426b993b4b7b043c8e92d3becf7752f56229ecabedf9e7a95e7ab897e5d4
  transactions     rows= 1 sha256=4c6a26bb3168d0da151655f598f70e06234c7ecec50fbe4cc89c18370c06c1f8
  payments         rows= 1 sha256=a739748d8f82f16ab7722f402ccfe62f54306e3d28311938516bdfd96a8606fc
row preservation: all probed tables byte-identical
final tables: 32
```

`npm run db:migrate` was also run twice on a genuinely fresh database: 24 journal
rows and 32 tables, no error on the second run.

## CI

`.github/workflows/ci.yml` uses only a job-local `postgres:17` service. No
production secret is referenced, so no CI test can reach production. The
migration test gets its own database name, which the comment says is required. Its
environment was reproduced locally and `npm test` passed 220/220.

One defect, reported not fixed: `ci.yml` never runs `npm run check`, so the 183
Biome errors cannot fail the build. `scripts/` is also outside Biome's `includes`,
so new scripts are not linted at all.

## Known failures

| Gate | Today |
| --- | --- |
| `npm test` (offline) | 143 tests, 103 pass, 40 skip, 0 fail |
| `npm test` (disposable DB) | 220 pass, 0 fail |
| `npx tsc --noEmit` | clean |
| `npm run check` | **183 errors, 18 warnings** (pre-existing) |
| `npm run build` | passes, no credentials needed |
| `drizzle-kit generate` | **fails** — no TTY, and the diff would be wrong |
| `drizzle-kit check` | exits 0, but does not detect the defects above |
