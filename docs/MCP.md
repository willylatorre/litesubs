# liteSubs API and remote MCP

## Implementation status

Implemented: tenant-scoped services, REST v1, remote MCP, Better Auth OAuth and
API keys, consent page, public discovery routing, complimentary enrollment and
invite claims, atomic credit adjustments, invite and outgoing-webhook tools, and
a clean migration baseline.

The remote endpoint is **`https://litesubs.com/api/mcp`**, once this code is
deployed. It is not a local stdio server. No deployment or production database
reset has been performed by this work.

## Deploying the baseline

`drizzle/0000_init.sql` is the squashed starting schema (auth, Connect,
integrations, invites). `drizzle/0001_plans_enrollments.sql`
renames `products`/`lite_subscriptions` to `plans`/`enrollments`, moves
commercial terms into `plan_versions`, and removes the platform
`user.stripe_customer_id`. `drizzle/0002_connected_accounts.sql` replaces the
Express/account-type model with `connected_accounts` and drops the platform
payout tables. `0003`–`0020` then add, in order: Connect OAuth for existing
accounts, immutable published plan versions, creator-owned direct-charge
purchases, credit grants, subscriptions and renewals, period-end cancellation,
expiring invites, refunds, subscription-aware disconnection, native bookings,
outgoing webhooks, split Google calendar roles, removal of the Cal.com tables,
Better Auth usernames, removal of the booking tables (scheduling moved to
Plannerie), removal of the commission, and creator tiers.

**An existing database upgrades in place.** `npm run db:migrate` applies every
unrecorded migration and preserves accounts, enrollments, and ledger rows. Every
previously active plan becomes a published version holding its old price and
credits; a previously disabled plan becomes a draft. Nothing already sold changes
terms. `lib/migrations.test.ts` replays the whole list against a throwaway
database to keep that contract honest.

An explicitly approved app-only rebuild can be run with
`node scripts/reset-app-db.mjs --confirm-reset`. This snapshots old app rows as
JSON in a private `litesubs_backup_*` schema, rebuilds from 0000 and replays every
later migration in one transaction, and refuses external dependencies rather than
using CASCADE. Supabase-managed schemas are untouched. Repeating it after the
journal is recorded is a no-op, not another reset. This **destroys accounts**, so
it is never the upgrade path for a live database.

1. Set `DATABASE_URL` to the target database in local/CI/Coolify environments.
2. Run `npm run db:migrate`. On an empty database this applies 0000 onward; on an
   existing one it applies only the migrations not yet recorded.
3. Deploy the app.

Only a deliberate greenfield rebuild needs a reset.

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
DATABASE_URL=<PostgreSQL database URL>
STRIPE_SECRET_KEY=<platform secret, used only to act on connected accounts>
STRIPE_WEBHOOK_SECRET=<signing secret for the Connect endpoint below>
```

Optional integrations. Each block is independent: leave one unset and its feature
is simply not offered, while the rest of the product keeps working.

```env
# Existing-account connection over Connect OAuth. Without it the setup screen
# only offers new-account onboarding.
STRIPE_CONNECT_CLIENT_ID=<Connect client id, not a secret>

# Google sign-in.
GOOGLE_CLIENT_ID=<oauth client id>
GOOGLE_CLIENT_SECRET=<oauth client secret>

# Platform billing (creator -> liteSubs, $5/mo). Created on the platform's own
# account. Without BOTH values the @better-auth/stripe plugin is not registered,
# so checkout is simply not offered and the rest of the app runs on the free tier.
STRIPE_PREMIUM_PRICE_ID=<price id for $5/month>
STRIPE_WEBHOOK_BILLING=<signing secret for the platform endpoint>
```

**The Stripe webhook endpoint must be a Connect endpoint** (`connect: true`).
liteSubs sells with direct charges, so a purchase happens on the creator's
connected account and Stripe raises those events there. A platform endpoint never
sees them, and the handler deliberately bails out when `event.account` is absent
because that field decides whose credits to grant. Credits are granted **only**
by the webhook — the success page never grants and there is no cron — so a
missing subscription means a paid customer receives nothing.

> **There are two endpoints, one per billing domain.** The table
> `litesub_subscription` is liteSubs being paid; `subscriptions` is a creator's
> customer paying the creator. They use different Stripe accounts, so they need
> different endpoints and **different signing secrets**. See
> `docs/PLATFORM-BILLING.md`.

Subscribe the **Connect** endpoint to all eleven handled events: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`,
`invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`charge.refunded`, `account.updated`, and
`account.application.deauthorized`. A second platform endpoint on the same URL is
not merely redundant: it delivers its own subset to the same handler, so keep
exactly one Connect endpoint per host. The old `STRIPE_WEBHOOK_PURCHASES`
variable is unused.

Subscribe the **platform** endpoint — `/api/auth/stripe/webhook`, owned by
`@better-auth/stripe`, verified with `STRIPE_WEBHOOK_BILLING` — to
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, and
`invoice.paid` / `invoice.payment_failed`. Do **not** add these to the Connect
endpoint: platform events carry no `event.account`, and the Connect handler
correctly refuses them.

**Observed on the live test endpoint (2026-11-22):** the Connect endpoint was
subscribed to only five events (`account.updated`, `charge.refunded`,
`checkout.session.completed`, `checkout.session.expired`,
`radar.early_fraud_warning.created`). It was missing `invoice.paid`,
`invoice.payment_failed`, `invoice.payment_action_required`,
`customer.subscription.updated`, `customer.subscription.deleted`, and
`checkout.session.async_payment_succeeded` — which means **subscription renewals
would never have granted credits**, and a delayed payment method would have been
paid for and never fulfilled. Fixing the dashboard is an operator step; the code
is ready for all eleven.

Monthly Checkout is no longer gated to test mode. One-time and monthly Checkout
both work in either Stripe mode; what is still enforced is that an event's mode
matches its connected account's recorded mode. A live event for a test account
(or the reverse) cannot legitimately reference that account, so it fails closed
with `400`; a row whose mode was never recorded is trusted rather than blocked.

Keep the MCP resource URL stable: it is the token audience. Development may use
`http://localhost:3000/api/mcp`; non-loopback resources require HTTPS. Never derive
the audience from an untrusted Host header.

Creator sales use direct charges on each creator's connected account. The
**only** platform Customer is the creator's own, created lazily at Premium
checkout for platform billing — never at signup. The Connect endpoint is
`/api/webhooks/stripe`, verified with `STRIPE_WEBHOOK_SECRET`; the platform
endpoint is `/api/auth/stripe/webhook`, verified with `STRIPE_WEBHOOK_BILLING`.
Credits arrive from confirmed payment, not the return page. Email delivery is not
implemented: creators must forward returned links.

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

Client support, as verified against each vendor's metadata documents:

| Client | Creator tools (OAuth) | Consumption (`x-api-key`) |
| --- | --- | --- |
| Claude Code, claude.ai, Claude Desktop/mobile | yes, CIMD | yes |
| ChatGPT (web, custom MCP server) | yes, CIMD | yes |
| Codex CLI | yes, CIMD | yes |
| VS Code / Copilot Chat 1.106+ | yes, CIMD | yes |
| Cursor | no (DCR-only, not implemented here) | yes |
| Gemini CLI, Copilot Studio | no (DCR-only) | yes |

Cursor and other DCR-only clients need a pre-registered OAuth client, which this
version does not ship. Adding one means registering a fixed `client_id` with its
redirect URIs and letting users paste it; do not re-enable open dynamic
registration to solve it, because `/register` would mint creator-scoped clients
without authentication.

The install steps users actually see live in `components/docs/mcp-install.tsx`;
link builders and their tests are in `lib/mcp-install-links.ts`. Client formats
change often — re-check the vendor docs named in those comments before editing.


The JWT plugin is configured in OAuth-provider mode: `/token` is disabled and
session JWT response headers are disabled. Refresh-token reuse overlap is zero.
OAuth client/resource administration is denied through public management routes.

OAuth scopes:

- `plans:read`, `plans:write`
- `customers:read`, `customers:write`
- `billing:read`
- `webhooks:manage` — configure outgoing webhooks and read their delivery
  history. Separate from `plans:write` because an endpoint decides where customer
  ids and balances are sent. See `docs/WEBHOOKS.md`.

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
| `publish_plan`, `unpublish_plan` | `plans:write` |
| `list_customers`, `get_customer` | `customers:read` |
| `list_invites` | `customers:read` |
| `enroll_customer`, `grant_credits`, `create_invite` | `customers:write` |
| `list_transactions` | `billing:read` |
| `list_webhooks`, `create_webhook`, `update_webhook`, `delete_webhook`, `list_webhook_deliveries`, `retry_webhook_delivery`, `send_test_webhook` | `webhooks:manage` |
| `consume_credits` | API key `credits:consume` only |

**Integration endpoints** (OAuth only — a machine key is refused with `FORBIDDEN`):

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/customers` | Provision a customer by email (unclaimed account, idempotent) |
| `POST /api/v1/integrationkeys` | Mint the consume-scoped key for this connection |
| `GET /api/v1/integrationkeys` | List minted keys as metadata, never secrets |
| `DELETE /api/v1/integrationkeys/:id` | Revoke a key minted by this connection |

A connection needs two credentials by design: OAuth for management, and the
minted machine key for consumption. `POST /integrationkeys` requires
`customers:write`; the raw key is returned once and cannot be retrieved again.

Creator connections see twenty creator tools; machine keys see only
`consume_credits`. Services enforce scopes again even if tool visibility changes;
a machine key is rejected at the service layer even where a scope check would
otherwise pass. Scope failures return structured tool errors; payout/refund
tools are absent. The earlier draft incorrectly claimed
`createInsufficientScopeError` was missing: the settled installation exports it
from `better-auth/oauth2`. Dynamic step-up is not implemented by this version of
the application.

**Invites and outgoing webhooks were REST-only and are tools now.** Without them
an assistant could not onboard someone who has no account, or build anything that
reacts to a credit change. Both use the same services as REST, so validation and
scoping are identical:

- `create_invite` takes an optional `email` and an optional `planId`. The email
  only decides whose dashboard the invite appears under; it does **not** restrict
  who may accept the link, so a forwarded link still works. It returns the URL
  and sends no email. Asking twice for the same email and plan returns the
  existing link instead of a second one.
- `create_webhook` returns the signing secret **once**; it can never be read
  again. `delete_webhook` requires `confirm: true` because the endpoint stops
  receiving events immediately and cannot be restored. `send_test_webhook`
  proves a receiver's signature verification before real events depend on it.
  See `docs/WEBHOOKS.md` for the payload and verification contract.

**Publication is exposed over MCP.** `publish_plan` provisions the Product/Price
on the creator's connected account exactly as the dashboard does, and
`unpublish_plan` stops new sales while leaving existing customers, purchases,
and subscriptions untouched. `unpublish_plan` requires `confirm: true` so a model
cannot end sales by accident, and both tools share the service layer's readiness
checks, idempotency, and `PLAN_NOT_PUBLISHED`/`PAYMENTS_NOT_READY` errors —
`enroll_customer` and the dashboard see identical behaviour. Plan names resolve
exactly as in the other plan tools: an ambiguous name returns candidates rather
than guessing.

Mutation annotations request client confirmation, but annotations are not a
security boundary. Credit tools require `reason`, support `dry_run`, and return
before/after balances. Client approval and preview cannot replace server checks.

`server/discover` returns server-level `instructions` (`lib/mcp-tools.ts`) with
the cross-tool rules: suggested tool order, major-vs-minor price units, the
idempotency-key convention, and the consumption/OAuth split. Clients show it to
the model once, so keep the opening paragraph self-contained.

## Domain rules

A **plan** holds editable service identity (name and description). Its commercial
terms live in **plan versions**: a creator edits a `draft` until it is published,
and a `published` version is immutable so existing customers keep the price and
credits they bought. An **enrollment** is the unique customer/plan row in
`enrollments` holding the credit balance projection. A monthly plan also has a
separate Stripe subscription record; the enrollment is still the customer's
credit balance, not the billing identity. Booking is the reverse of that

Customer read APIs return usable grant balances alongside subscription status
and paid-through dates; an overdue status never extends the last paid period.

Only published plans are sellable. Creating a plan creates local draft terms and
never contacts Stripe. Enrollment, invites, credit grants, and consumption all
resolve through the published-terms lookup and return `PLAN_NOT_PUBLISHED` for a
draft, whichever transport asked.

Plan/customer resolution accepts IDs and exact names (customers also accept
emails). Searches are tenant-scoped; ambiguity returns candidates rather than
guessing. Enrollment may resolve a new account by exact email/ID, but never
searches other creators' customers by name or creates bare accounts.

`enroll_customer` defaults to `invoice`. Existing users receive a single-use
Checkout Session URL and zero initial credits; monthly plans use subscription
Checkout and grant only after the first paid invoice. Both billing modes are
allowed in live Stripe mode; only an event whose mode disagrees with its
connected account is refused. `comp` requires a reason and grants one-time plan
credits; monthly complimentary enrollment is not supported. Re-comping an
existing enrollment is rejected.

Unknown emails receive an expiring invite and a URL to forward. Invite URLs are
`/invite/<username>/<token>` and creator-issued payment requests are
`/pay/<username>/<token>`; the opaque token still owns claim/payment authority.
Creators must choose a permanent username before these links can be issued. Comp
invites snapshot the credit grant/reason and grant once on claim, with a row lock
and transactional enrollment+ledger insertion. An `invited` result is **not** a
completed enrollment and no email has been sent.

Plan terms include `billingMode` (`one_time` or `recurring`) and, for recurring
plans, `interval: "month"` — yearly offers are deferred. Writes use **major
currency units** (`price: 10` means $10); responses return **minor units**
(`price: 1000`) plus the explicit `currency`. Editing terms replaces the draft
working copy and does not change credits already granted.

Credit changes use `lib/services/credits.ts`. Transactions lock the enrollment,
prevent overdrafts, write the balance and ledger atomically, and save the original
before/after balances for stable replay receipts. The database CHECK is a backstop.

Consumption requires a caller-supplied `idempotency_key`. Grants support an
optional key. Uniqueness is per creator; concurrent retries serialize on the key
and debit once. Reusing a key with a different customer/plan/amount/type/reason
returns `IDEMPOTENCY_CONFLICT`. Dry runs do not reserve keys or write data.

Purchases are direct charges on the creator's own connected Stripe account with
**no application fee**: the creator keeps the whole sale. There is no
platform-charge fallback: a creator without a payment-ready account cannot sell.
The only subscription liteSubs bills itself is the optional Premium tier, which
is collected on the platform account and therefore carries no `event.account`.

System paths (Stripe fulfillment and comp enrollment/claim) retain their own
transactional ledger writes.

**Scheduling is not a liteSubs feature.** liteSubs exposes the credit-consuming
API; an external scheduler (Plannerie) calls `POST /api/v1/credits/consume` with
a stable `idempotency_key` derived from its own booking id and stores the
returned transaction id as its reference. It never keeps a local balance. See
`docs/REFOCUS.md`.

## Connected accounts and readiness

Each creator connects their own Stripe account, either by onboarding a new one or
by authorizing an existing business over Connect OAuth. `connected_accounts`
stores the account identity, the agreed controller responsibilities (full
Dashboard, Stripe-billed processing fees, Stripe-managed negative balances), and a
cache of Stripe's reported capabilities. Readiness is derived from the
`card_payments` capability plus `charges_enabled` and Stripe's requirement/disable
state, never from "a row exists", so an incomplete or restricted account cannot
start a sale. Accounts are judged by those responsibilities, not by which endpoint
created them.

liteSubs no longer runs a platform payout ledger, payout requests, or payout
method preferences. Stripe pays out on the creator's own account.

## REST v1

| Method | Endpoint |
| --- | --- |
| GET / POST | `/api/v1/plans` |
| GET / PATCH | `/api/v1/plans/:id` |
| POST | `/api/v1/plans/:id/publish` |
| POST | `/api/v1/plans/:id/unpublish` |
| GET | `/api/v1/customers` |
| GET | `/api/v1/customers/:id` |
| POST | `/api/v1/enrollments` |
| POST | `/api/v1/credits/grant` |
| POST | `/api/v1/credits/consume` |
| GET | `/api/v1/transactions` |
| GET / POST | `/api/v1/invites` |
| GET / POST | `/api/v1/webhooks` |
| PATCH / DELETE | `/api/v1/webhooks/:id` |
| POST | `/api/v1/webhooks/:id/test` |
| GET | `/api/v1/deliveries` |
| POST | `/api/v1/deliveries/:id/retry` |

Outgoing webhooks (`purchase.completed`, `credits.changed`) are signed with
HMAC-SHA256 and delivered best-effort at the ledger change; see
`docs/WEBHOOKS.md` for the payload, headers, verification snippet, and the
retry contract.

`/llms.txt` serves a curated plain-text index for agents (site summary, docs
anchors, MCP scopes and tool list, REST routes, and the calling rules that are
easy to get wrong). It is generated from `lib/llms-txt.ts`; update it when tool
names or endpoints change. It is an index, not a second copy of this doc.

List routes take `limit` (1–100, default 50) and `offset`. Reads/writes return
plain JSON. Errors include `code`, `error`, and optional `details`/`fieldErrors`.
`publish` and `unpublish` are third-segment transitions on a plan. Over MCP,
`unpublish_plan` requires the caller to pass `confirm: true`; the REST route
supplies that confirmation itself, because an HTTP call is already an explicit
act. The former `/api/products` compatibility adapter is gone: plans are the only
contract, so no legacy path can bypass draft status. Dashboard hooks use v1.

Example machine request (substitute your IDs and keep the event key stable):

```sh
curl https://litesubs.com/api/v1/credits/consume \
  -H 'x-api-key: <key>' -H 'Content-Type: application/json' \
  -d '{"customer":"student@example.com","plan":"Algebra","amount":1,"reason":"Lesson completed","idempotency_key":"delivery_8812"}'
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
  MIGRATION_TEST_DATABASE_URL=<disposable DB> \
  NEXT_PUBLIC_APP_URL=http://localhost:3000 BETTER_AUTH_URL=http://localhost:3000 \
  NODE_ENV=development npx tsx --test lib/mcp.integration.test.ts lib/migrations.test.ts
```

`MIGRATION_TEST_DATABASE_URL` is dropped and recreated by the migration test, so
point it at a disposable database only. Without it those cases skip. CI sets all
three from a single Postgres service, which is why the migration tests do run
there.

CI is one workflow (`.github/workflows/ci.yml`): install, migrate, typecheck,
test, build and audit run once per push or pull request against a Postgres
service. Do not add a second workflow that re-runs `npm test` without a
database; its integration tests would only skip and the job would duplicate
work.

Tests cover concurrent retry receipts, overdraft prevention, dry-run persistence,
tenant and credential boundaries, once-only comp claims, HTTP API-key auth,
restricted MCP discovery, REST scope denial, public OAuth metadata, and that the
0001 migration preserves rows and backfills picked terms. Further integration
suites cover direct-charge purchases and application fees, subscription
renewal/cancellation/disconnection, refunds revoking only the refunded units,
signed outgoing webhooks and their retry/idempotency rules, creator tiers
(including the exclusion constraint under concurrency), Google token encryption,
and Better Auth usernames. An HTTP integration test also covers signed consent
(including tampering rejection), PKCE code exchange, rotating refresh tokens, and
an authenticated MCP call plus read-token write denial. `lib/api-docs-drift.test.ts`
keeps the agent-facing docs honest: an undocumented route group, an undocumented
or phantom tool, or a reference to a source file that no longer exists fails the
suite. Browser UI/client compatibility and live Stripe checkout still require
deployment/sandbox validation.

For an explicitly approved deployed checkout check, run
`node scripts/smoke-sandbox-checkout.mjs --sandbox-only` inside the app container.
It refuses live Stripe keys, creates two disposable accounts and a $1 plan,
validates an unpaid invoice checkout and its metadata, expires it, and removes
the app fixtures and Stripe test customers. It never submits a payment.

## Final product tasks

- [x] Announce MCP availability on the landing page, with links to connection and API docs.
- [x] Publish `/docs` covering REST API authentication/endpoints and remote MCP connection/usage (also available in `/dashboard/developers`).
- [x] Add `/dashboard/developers/api-keys` for token generation/revocation using Better Auth's key UI, with a sidebar entry.
