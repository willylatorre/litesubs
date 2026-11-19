# Litesubs

A platform for creators to sell credit plans. A plan is either a one-time pack
or a monthly allowance. Creators prepare a plan as a draft, publish immutable
terms on their own Stripe account, and customers spend credits over time —
through the API, through native booking schedules, or from an AI assistant over
MCP.

# Getting Started

To run this application:

```bash
npm install
npm run dev
```

`npm run dev` starts Next.js on http://localhost:3000. You need `DATABASE_URL`
pointing at a PostgreSQL database with migrations applied (`npm run db:migrate`);
see [Required configuration](docs/MCP.md#deploying-the-baseline) for the rest.

# Building For Production

To build this application for production:

```bash
npm run build
```

**Run the build with `NODE_ENV=production`.** `next build` expects a production
`NODE_ENV`; if your shell exports `NODE_ENV=development` (common when a dev
server or another project set it), the build can fail while prerendering
`/_global-error` with a confusing `Cannot read properties of null (reading
'useContext')`, even though the code is fine. CI sets it for you.

```bash
NODE_ENV=production npm run build
```

## Testing

Tests run on the built-in Node test runner via `tsx` (not Vitest). You can run
them with:

```bash
npm test
```

### Integration tests

About half the suite (purchase, subscriptions, refunds, webhooks, OAuth,
publication, credits, bookings, MCP) runs against a real PostgreSQL database and
**silently skips** unless `MCP_TEST_DATABASE_URL` is set. Only the Stripe adapter
is stubbed. The tests assert `DATABASE_URL === MCP_TEST_DATABASE_URL`, so a green
run without it means those paths were never exercised.

```bash
# One disposable database, migrated once.
psql -d postgres -c "DROP DATABASE IF EXISTS litesubs_integration_test;"
psql -d postgres -c "CREATE DATABASE litesubs_integration_test;"

set -a; source .env; set +a
export DATABASE_URL="postgresql://localhost/litesubs_integration_test"
export MCP_TEST_DATABASE_URL="$DATABASE_URL"
npx drizzle-kit migrate
npm test
```

Two gotchas found the hard way:

- **Export the whole `.env`, not just the database URLs.** `BETTER_AUTH_URL`
  missing makes better-auth's JWT issuer empty (`TypeError: Invalid URL`).
- **Recreate the database after changing secrets.** JWKS rows are encrypted with
  `BETTER_AUTH_SECRET` at creation; a database seeded before the secret was
  loaded fails with `Failed to decrypt private key`, not a clear config error.

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.


## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The following scripts are available:


```bash
npm run lint
npm run format
npm run check
```


## Shadcn

Add components using the latest version of [Shadcn](https://ui.shadcn.com/).

```bash
npx shadcn@latest add button
```



## Project layout

The app is **Next.js App Router**, not TanStack Router. Routes are directories
with a `page.tsx` under `app/`.

| Path | What lives there |
| --- | --- |
| `app/<route>/page.tsx` | A page. Public pages: `/book`, `/invite`, `/pay`, `/docs`. |
| `app/dashboard/` | The authenticated creator and customer surfaces. |
| `app/api/v1/[...resource]/route.ts` | The REST v1 router. One catch-all, one `switch` on method + group. |
| `app/api/mcp/route.ts` | The remote MCP endpoint (stateless POST). |
| `app/api/webhooks/stripe/` | Stripe fulfillment. Must be a **Connect** endpoint; credits are granted only here. |
| `app/actions/` | Server Actions the dashboard calls. |
| `app/db/` | Drizzle schema and client. |
| `lib/services/` | Business logic. Every transport (REST, MCP, Server Action, UI) calls these. |
| `lib/*.test.ts` | Tests, including `*.integration.test.ts` against a real database. |
| `docs/` | Deeper contracts: `MCP.md`, `SUBSCRIPTIONS.md`, `WEBHOOKS.md`, `BOOKINGS.md`. |
| `drizzle/` | Migrations. `0000` is the squashed baseline; later files are applied in order. |

Adding a page means creating a directory with a `page.tsx`, not registering a
route in a config file. Use `next/link` for navigation.

## How the pieces fit

- **Services own the rules.** `lib/services/*` is where scope checks, money
  arithmetic, and database transactions live. A transport that reimplements them
  will drift; call the service instead.
- **Plans are drafts until published.** Commercial terms live in `plan_versions`;
  a `published` version is immutable so a price change never rewrites what an
  existing customer bought.
- **Credits move through one service.** `lib/services/credits.ts` locks the
  enrollment, prevents overdrafts, and writes the balance and ledger atomically.
  Bookings, refunds, comps, and the API all go through it, so expiry and
  idempotency are not reimplemented per feature.
- **Money is integer minor units** with an explicit currency. Periods are UTC
  instants plus an explicit IANA timezone.
- **Payments are direct charges** on each creator's own connected Stripe account
  with a 2% application fee. There is no platform-charge fallback.

Before changing a money path, read the matching document in `docs/`. Those files
record the invariants and the reasoning, including what was deliberately not
built.

## Agent and API surface

`/llms.txt` and `/docs` are the published index for API and MCP consumers;
`docs/MCP.md` is the fuller reference. `lib/api-docs-drift.test.ts` fails when a
route group or MCP tool is undocumented, or when a doc points at a source file
that no longer exists — so update the docs in the same change as the code.

## Contributing notes

- Read `AGENTS.md` first. The installed Next.js version has breaking changes from
  older releases; check `node_modules/next/dist/docs/` before writing framework
  code rather than relying on memory.
- Keep changes consistent with the surrounding code, and preserve unrelated work
  in the tree.
- A test-only hook in production code is a smell. Prefer exercising the real
  boundary; `lib/services/*` is callable from tests without one.
- When a test asserts behavior the docs promise, confirm it fails on the pre-fix
  code. A regression test that never demonstrably failed proves the mock.
