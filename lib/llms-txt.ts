import { getAppUrl } from "@/lib/app-url";
import { mcpResource } from "@/lib/mcp-config";

/**
 * Curated plain-text index for language models, following the llms.txt
 * convention (https://llmstxt.org/). Keep it short and factual: it is an index,
 * not a copy of the docs. If this grows past a screen or two, move detail into
 * /docs and link to it.
 */
export function buildLlmsTxt(): string {
	const base = getAppUrl();

	return `# liteSubs

> liteSubs is a platform for selling credit plans instead of recurring
> subscriptions. Creators define plans (a number of credits at a price), enroll
> customers, and consume credits from their own apps through a remote MCP server
> or a REST API. Credits belong to one customer and one plan; their balance cannot
> go negative. Plans start as drafts and become purchasable only once a version is
> published on the creator's own Stripe account.

- App: ${base}
- Docs: ${base}/docs
- Sample workspace (read-only demo): ${base}/sample
- MCP endpoint: ${mcpResource}
- REST base URL: ${base}/api/v1

## Docs

- [Quickstart](${base}/docs#quickstart): create a plan, enroll a customer, consume a credit.
- [Connect an AI assistant](${base}/docs#mcp): remote MCP endpoint and client configuration.
- [Authentication](${base}/docs#authentication): OAuth for creators, API keys for machine callers.
- [REST API](${base}/docs#api): endpoints, request bodies, error shapes.
- [Credits and retries](${base}/docs#credits): balances, idempotency, dry runs, receipts.
- [Enrollment](${base}/docs#enrollment): invoice checkout links, complimentary grants, invites.

## Remote MCP

- Transport: stateless HTTP POST only. Protocol revision 2026-07-28. Legacy
  session-oriented and DCR-only clients are not supported.
- Client identification: CIMD with SSRF protections.
- Auth: OAuth authorization code + PKCE. No cookie sessions on MCP.
- Scopes: plans:read, plans:write, customers:read, customers:write, billing:read,
  webhooks:manage.
- Creator tools: list_plans, get_plan, create_plan, update_plan, publish_plan,
  unpublish_plan, list_customers, get_customer, enroll_customer, list_invites,
  create_invite, grant_credits, list_transactions, list_webhooks, create_webhook,
  update_webhook, delete_webhook, list_webhook_deliveries,
  retry_webhook_delivery, send_test_webhook.
- API-key tools: whatever scopes the key was minted with, so a dashboard key
  (starting at credits:consume) sees consume_credits only, while a key minted
  with creator scopes sees those tools too. Scopes come from the stored key,
  never from the request.
- Invites and webhooks work over MCP and REST alike. An invite's email is
  optional and only decides whose dashboard it appears in. A webhook signing
  secret is returned once at creation. Webhook tools need webhooks:manage, which
  no path mints onto a key: a delegated key must not choose where a tenant's
  data is sent.
- No payout or refund tools are exposed. Refunds are issued in the creator's
  Stripe Dashboard; liteSubs then revokes only the refunded purchase's unspent
  credits.
- Mutation tools request client confirmation, but that is not a security
  boundary; every operation is re-checked server-side.
- publish_plan provisions the offer on the creator's connected Stripe account and
  needs a payment-ready account. unpublish_plan requires confirm: true because it
  ends new sales; existing customers keep their credits.

## Installing the MCP server

Full per-client instructions: ${base}/docs#mcp

- Claude Code: claude mcp add --transport http --scope user litesubs ${mcpResource}
  then claude mcp login litesubs (or /mcp inside a session).
- Claude (claude.ai, Desktop, mobile): Customize > Connectors > Add custom
  connector, URL ${mcpResource}, keep "Use Claude's published identity".
- ChatGPT: web app > Plugins > Add custom MCP server, URL ${mcpResource},
  authentication OAuth.
- VS Code (Copilot Chat, 1.106+): add ${mcpResource} as a remote HTTP server and
  approve the browser sign-in.
- Codex CLI: codex mcp add litesubs --url ${mcpResource} then codex mcp login.
- Cursor: OAuth is not possible yet (it does not support CIMD and this server
  does not run open dynamic client registration). Configure the URL with an
  x-api-key header instead. A key may carry management scopes as well as
  consumption, but Cursor will not see the OAuth-only tools.
- Other clients: remote streamable HTTP over HTTPS plus CIMD support for OAuth,
  or an API key, whose reach is whatever scopes it was created with.

## REST API

Machine keys and OAuth tokens both work. Send JSON with
Content-Type: application/json. Lists accept limit (1-100, default 50) and offset.

- GET /api/v1/me - the credential's creator, tier and own scopes
- GET, POST /api/v1/plans - list or create plans
- GET, PATCH /api/v1/plans/:id - read or update a plan
- POST /api/v1/plans/:id/publish - publish the draft offer
- POST /api/v1/plans/:id/unpublish - stop new sales
- GET /api/v1/customers - enrolled customers with per-plan balances
- GET /api/v1/customers/:id - one customer's balances
- POST /api/v1/enrollments - enroll or invite a customer
- POST /api/v1/credits/grant - grant credits
- POST /api/v1/credits/consume - consume credits (machine keys)
- GET /api/v1/transactions - transaction history
- GET, POST /api/v1/invites - list or create invites
- GET, POST /api/v1/webhooks - list or create outgoing webhook endpoints
- PATCH, DELETE /api/v1/webhooks/:id - update or delete an endpoint
- POST /api/v1/webhooks/:id/test - send a test credits.changed event
- GET /api/v1/deliveries - delivery history for your endpoints
- POST /api/v1/deliveries/:id/retry - retry one failed delivery

Invites and webhooks are available as MCP tools and over REST. Invites use
customers:read (list) and customers:write (create); webhooks need webhooks:manage.

Errors return code, error, and optional details or fieldErrors. Status codes:
400 invalid input, 401 authentication, 403 missing scope, 404 missing resource,
409 ambiguous identifier or credit conflict.

## Rules that change how you call the API

- Plan prices: input in major units (10 means $10); responses return minor units
  (1000 cents). Draft plans are never purchasable or enrollable until a version is
  published. Editing terms does not change credits already granted.
- Billing: billingMode is one_time or recurring; recurring requires interval
  "month" (yearly is deferred). Monthly plans renew and their credits
  do not roll over.
- Sales and spending come from confirmed receipts (payments,
  subscription_invoices), never from credit-ledger rows or current plan prices.
  money on customers is grouped by currency with gross, refunded, and net;
  USD and EUR are never added together. Pending Checkouts, manual grants, and
  complimentary credits are not sales.
- consume_credits requires an idempotency_key derived from the business event
  (order ID, message ID), not a timestamp. Retrying with the same key returns
  the original receipt; a different payload under the same key is rejected.
  Consumption spends expiring credits first (soonest expiry), then older
  non-expiring ones; a debit is all-or-nothing and never partially applies.
  Expired credits are unusable immediately, not when a cleanup job runs.
- grant_credits takes an optional idempotency_key. reason is required and appears
  in the customer ledger. One-time credits never expire; credits added to a
  monthly plan inherit the current paid period, and expires_at is required when
  no period is paid. dry_run previews the before/after balance, expiry included,
  without writing or reserving a key.
- Enrollment defaults to invoice mode: it returns a Checkout Session link and
  grants credits only after payment. Complimentary mode (comp) requires a reason
  and grants the plan's current credits once. A customer-specific purchase
  request returns a single-use /pay link bound to that signed-in buyer; forward
  it instead of reusing it.
- Unknown emails receive an expiring invite with a claim link; that is not a
  completed enrollment. No email is sent: the creator forwards payment and claim
  links.
- Identifier lookups accept IDs and exact names (customers also accept emails).
  Ambiguous names return candidates instead of guessing.

## Optional

- [Landing page](${base}): product overview and demo.
- [API tokens](${base}/dashboard/developers/api-keys): generate or revoke machine
  keys (requires sign-in).
- [Terms](${base}/terms): the agreement between users and liteSubs.
- [Privacy](${base}/privacy): what data liteSubs collects and why.
`;
}
