# Litesubs API and remote MCP

## Implementation status

Implemented: tenant-scoped services, REST v1, remote MCP, Better Auth OAuth and
API keys, consent page, public discovery routing, complimentary enrollment and
invite claims, atomic credit adjustments, and a clean migration baseline.

The remote endpoint is **`https://litesubs.com/api/mcp`**, once this code is
deployed. It is not a local stdio server. No deployment or production database
reset has been performed by this work.

## Deploying the fresh baseline

The database is disposable by product decision, but migrations do not silently
reset it. `drizzle/0000_init.sql` contains the entire schema, including existing
payout/Connect/integration features, invite expiration, and new auth tables.
Historical migration files were squashed; several were absent from the journal.

An explicitly approved app-only production reset can be run with
`node scripts/reset-app-db.mjs --confirm-reset`. This snapshots old app rows as
JSON in a private `litesubs_backup_*` schema, replaces only the explicit app
tables/enums and Drizzle history in one transaction, and refuses external
dependencies rather than using CASCADE. Supabase-managed schemas are untouched.
Repeating it after the baseline is recorded is a no-op, not another reset.

1. Provision/select a **fresh, empty** PostgreSQL database.
2. Set `DATABASE_URL` to that database in local/CI/Coolify environments.
3. Run `npm run db:migrate`.
4. Deploy the app and sign up again. Existing creator accounts are not retained.

`db:migrate` refuses to run against a pre-baseline database with an existing
`user` table. It never drops tables or resets a database. The GitHub migration
job uses this same guarded command when dispatched manually. Production uses
`npm run db:migrate && npm run start` inside Coolify's Docker network; a
GitHub-hosted runner cannot connect to the private database hostname. Subsequent
migrations work normally.

Required configuration:

```env
BETTER_AUTH_URL=https://litesubs.com
NEXT_PUBLIC_APP_URL=https://litesubs.com
MCP_RESOURCE_URL=https://litesubs.com/api/mcp
BETTER_AUTH_SECRET=<stable secret>
DATABASE_URL=<fresh PostgreSQL database URL>
```

Keep the MCP resource URL stable: it is the token audience. Development may use
`http://localhost:3000/api/mcp`; non-loopback resources require HTTPS. Never derive
the audience from an untrusted Host header.

Invoice enrollment also requires the existing Stripe credentials and verified
purchase webhook. Credits arrive from successful payment, not the return page.
Email delivery is not implemented: creators must forward returned links.

## Authentication

Packages: Better Auth/MCP/API-key/CIMD/OAuth-provider **1.7.21** and the official
`@modelcontextprotocol/server` SDK **2.4.0**. Dependencies are declared directly.

Creator clients authenticate with OAuth authorization code + PKCE. Better Auth
owns signed authorization queries, consent, issuance, refresh, JWKS verification,
issuer/audience/expiry checks, and protected-resource challenges. The app supplies
`/oauth/consent`, and its login client uses `oauthProviderClient()` so signed
authorization requests survive sign-in.

Client identification uses CIMD with the Node transport's SSRF protections.
Open dynamic client registration is disabled. Verify compatibility with the MCP
clients you intend to support; older DCR-only clients need a deliberate fallback.

The JWT plugin is configured in OAuth-provider mode: `/token` is disabled and
session JWT response headers are disabled. Refresh-token reuse overlap is zero.
OAuth client/resource administration is denied through public management routes.

OAuth scopes:

- `plans:read`, `plans:write`
- `customers:read`, `customers:write`
- `billing:read`

Machine keys use **`x-api-key`**, with Better Auth's `{ credits: ["consume"] }`
permissions. They may only consume credits, never grant credits, read billing,
or edit plans. `enableSessionForAPIKeys` stays **false**. Explicit credentials
take precedence over session cookies, and invalid credentials never fall back
to a more privileged cookie. Key verification applies expiration and rate limits.

REST accepts OAuth, API keys, or dashboard session cookies. Cookie-authenticated
mutations require a trusted Origin. MCP does not accept cookie sessions.

Public discovery:

- `/.well-known/oauth-protected-resource/api/mcp`
- `/.well-known/oauth-authorization-server/api/auth`
- `/api/auth/jwks`

Next routes the well-known URLs to the Better Auth handler. `/api/mcp` is outside
the dashboard-only auth proxy, so unauthenticated callers receive a 401 challenge
rather than a login redirect.

## MCP tools and transport

The endpoint accepts POST requests using MCP **2026-07-28**. It creates a fresh
server per request with a verified principal; no cross-request mutable auth
state or Redis session store. GET/DELETE are not exported. Legacy 2025
session-oriented traffic is rejected.

| Tool | Required scope |
| --- | --- |
| `list_plans`, `get_plan` | `plans:read` |
| `create_plan`, `update_plan` | `plans:write` |
| `list_customers`, `get_customer` | `customers:read` |
| `enroll_customer`, `grant_credits` | `customers:write` |
| `list_transactions` | `billing:read` |
| `consume_credits` | API key `credits:consume` only |

Creator connections see nine creator tools; machine keys see only
`consume_credits`. Services enforce scopes again even if tool visibility changes.
Scope failures return structured tool errors; payout/refund tools are absent.
The earlier draft incorrectly claimed `createInsufficientScopeError` was missing:
the settled installation exports it from `better-auth/oauth2`. Dynamic step-up
is not implemented by this version of the application.

Mutation annotations request client confirmation, but annotations are not a
security boundary. Credit tools require `reason`, support `dry_run`, and return
before/after balances. Client approval and preview cannot replace server checks.

## Domain rules

A **plan** is a product with price/credits. An **enrollment** is the unique
customer/plan row in `lite_subscriptions`. Neither is recurring Stripe billing.
Recurring billing remains out of scope.

Plan/customer resolution accepts IDs and exact names (customers also accept
emails). Searches are tenant-scoped; ambiguity returns candidates rather than
guessing. Enrollment may resolve a new account by exact email/ID, but never
searches other creators' customers by name or creates bare accounts.

`enroll_customer` defaults to `invoice`. Existing users receive a single-use
Checkout Session URL and zero initial credits. `comp` requires a reason and grants
the current plan's credits. Re-comping an existing enrollment is rejected.

Unknown emails receive an expiring invite and a URL to forward. Comp invites
snapshot the credit grant/reason and grant once on claim, with a row lock and
transactional enrollment+ledger insertion. An `invited` result is **not** a
completed enrollment and no email has been sent.

Plan writes use **major currency units** (`price: 10` means $10). Plan responses
return **minor units** (`price: 1000`). Changes affect future purchases, not
existing balances.

Credit changes use `lib/services/credits.ts`. Transactions lock the enrollment,
prevent overdrafts, write the balance and ledger atomically, and save the original
before/after balances for stable replay receipts. The database CHECK is a backstop.

Consumption requires a caller-supplied `idempotency_key`. Grants support an
optional key. Uniqueness is per creator; concurrent retries serialize on the key
and debit once. Reusing a key with a different customer/plan/amount/type/reason
returns `IDEMPOTENCY_CONFLICT`. Dry runs do not reserve keys or write data.

System paths (Stripe fulfillment and comp enrollment/claim) retain their own
transactional ledger writes; the existing payout and Connect subsystem is preserved.

## REST v1

| Method | Endpoint |
| --- | --- |
| GET / POST | `/api/v1/plans` |
| GET / PATCH | `/api/v1/plans/:id` |
| GET | `/api/v1/customers` |
| GET | `/api/v1/customers/:id` |
| POST | `/api/v1/enrollments` |
| POST | `/api/v1/credits/grant` |
| POST | `/api/v1/credits/consume` |
| GET | `/api/v1/transactions` |
| GET / POST | `/api/v1/invites` |

`/llms.txt` serves a curated plain-text index for agents (site summary, docs
anchors, MCP scopes and tool list, REST routes, and the calling rules that are
easy to get wrong). It is generated from `lib/llms-txt.ts`; update it when tool
names or endpoints change. It is an index, not a second copy of this doc.

List routes take `limit` (1–100, default 50) and `offset`. Reads/writes return
plain JSON. Errors include `code`, `error`, and optional `details`/`fieldErrors`.
Old products/invites paths are thin compatibility adapters; dashboard hooks use
v1. Cal.com's configuration endpoint is unchanged.

Example machine request (substitute your IDs and keep the event key stable):

```sh
curl https://litesubs.com/api/v1/credits/consume \
  -H 'x-api-key: <key>' -H 'Content-Type: application/json' \
  -d '{"customer":"student@example.com","plan":"Algebra","amount":1,"reason":"Lesson completed","idempotency_key":"booking_8812"}'
```

## Validation

Run typecheck/build and normal tests:

```sh
npx tsc --noEmit
npm run build
npm test
```

Integration tests require a **dedicated disposable** PostgreSQL database with the
baseline applied. No production test-data mutations or automatic resets:

```sh
DATABASE_URL=<test DB> MCP_TEST_DATABASE_URL=<same test DB> \
  NEXT_PUBLIC_APP_URL=http://localhost:3000 BETTER_AUTH_URL=http://localhost:3000 \
  NODE_ENV=development npx tsx --test lib/mcp.integration.test.ts
```

Tests cover concurrent retry receipts, overdraft prevention, dry-run persistence,
tenant and credential boundaries, once-only comp claims, HTTP API-key auth,
restricted MCP discovery, REST scope denial, and public OAuth metadata. An
HTTP integration test also covers signed consent (including tampering rejection),
PKCE code exchange, rotating refresh tokens, and an authenticated MCP call plus
read-token write denial. Browser UI/client compatibility and live Stripe
checkout still require deployment/sandbox validation.

For an explicitly approved deployed checkout check, run
`node scripts/smoke-sandbox-checkout.mjs --sandbox-only` inside the app container.
It refuses live Stripe keys, creates two disposable accounts and a $1 plan,
validates an unpaid invoice checkout and its metadata, expires it, and removes
the app fixtures and Stripe test customers. It never submits a payment.

## Final product tasks

- [x] Announce MCP availability on the landing page, with links to connection and API docs.
- [x] Publish `/docs` covering REST API authentication/endpoints and remote MCP connection/usage (also available in `/dashboard/developers`).
- [x] Add `/dashboard/developers/api-keys` for token generation/revocation using Better Auth's key UI, with a sidebar entry.
