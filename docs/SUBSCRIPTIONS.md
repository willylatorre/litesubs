# Creator-owned payments and subscriptions

Status: agreed architecture and implementation scope.

Implemented slices:

- S01 — draft plans with immutable version records; `plans`, `plan_versions`,
  and `enrollments` are the live domain names. See
  `drizzle/0001_plans_enrollments.sql` for the additive migration.
- S02 — new creator-owned Stripe onboarding with explicit controller
  responsibilities, derived payment readiness, a Payments setup screen, and the
  platform payout/earnings system removed. See
  `drizzle/0002_connected_accounts.sql`. The sandbox journey and Stripe
  configuration check remain for the operator (this slice is HITL).
- S03 — existing-account connection through Connect OAuth with single-use state,
  user-bound callbacks, an account-switch guard, and a responsibility
  compatibility check that refuses rather than silently changing an account. See
  `drizzle/0003_connect_oauth.sql`. Verified reading of the Stripe Connect docs
  also corrected the checkout implementation: it had been using destination
  charges (`transfer_data`), which is now fixed to true direct charges.
- S04 — publication in `lib/services/publish.ts`: a draft is provisioned as a
  Product/Price on the creator's connected account, the version is frozen with
  those references, replacing terms supersedes the previous version, and
  unpublishing archives the offer while keeping history. Exposed on every
  transport (`publishPlan`/`unpublishPlan`, `publish_plan`/`unpublish_plan` MCP
  tools, `POST /api/v1/plans/{id}/publish|unpublish`, and the plans dashboard).
  See `drizzle/0004_plan_publication.sql`.
- S05 — one-time purchase through direct-charge Checkout: one shared purchase
  service for self-service and creator-requested links, an account-scoped Stripe
  Customer per buyer and creator (claimed before the Stripe call so concurrent
  first purchases reuse one Customer), a `payments` receipt written before the
  session, fulfillment that grants once via a `pending -> paid` transition, and
  single-use hashed purchase-request tokens. See `drizzle/0005_s05_purchase.sql`.
- S06 — grant-aware consumption: credits are grants with their own remaining
  amount and expiry, debits allocate across them in a documented order and
  record the split, and the enrollment balance is a projection updated in the
  same transaction. Expiry is enforced on read. See
  `drizzle/0006_s06_credit_grants.sql`.
- S07 — monthly direct-charge Checkout with a creator-scoped Customer, persisted
  subscription identity/fee rate, and an idempotent first paid-invoice receipt
  that grants one allowance expiring at the Stripe line-item period boundary.
  Checkout/invoice event reordering is supported. See
  `drizzle/0007_s07_subscriptions.sql`.
- S08 — cycle invoice fulfillment grants one source-linked allowance per paid
  period, failed invoices mark overdue without extending paid-through, late
  periods are recorded without restoring expired credits, and customer/creator
  summaries read usable grant balances. See
  `drizzle/0008_s08_renewals.sql`.
- S09 — authenticated customers can schedule cancellation at period end or resume
  before it, account-scoped Stripe operations stay retry-safe, and lifecycle
  webhooks reconcile dashboard-side changes without moving paid-through. Ended
  subscriptions retain their history while a later purchase creates a new
  billing identity. See `drizzle/0009_s09_cancellation.sql`.
- S10 — customer billing portal configuration is provisioned on the platform,
  while each short-lived session is created for the authenticated customer's
  mapped Customer on its owning connected account. Plan changes and cancellation
  are disabled in the portal.
- S11 — invites pin the published version they offered, comp and manual grants
  carry an expiry (inherited from the paid period on monthly plans), and a claim
  refuses terms that were replaced after the invite was issued. See
  `drizzle/0010_s11_invites.sql`.
- S12 — successful refunds reconcile the account-scoped receipt and revoke only
  the remaining units of that purchase; partial refunds move money without
  guessing credits, and refunding a monthly invoice never cancels it. See
  `drizzle/0011_s12_refunds.sql`.
- S13 — creator and customer money reporting is receipt-derived, grouped per
  currency with gross/refunded/net, while counts, subscriptions, and usable
  credits stay separate concepts.

## Purpose

Litesubs supplies software for creators to sell credit packs and monthly plans.
The creator supplies the service and owns the customer payment relationship.
Products, Prices, Customers, payments, and subscriptions live on the creator's
connected Stripe account. Litesubs collects a 2% application fee.

Use Stripe's normal subscription lifecycle, retries, invoices, and billing portal.
Do not build a competing billing engine or a configurable policy framework in v1.

## Agreed defaults

- Direct charges for both one-time packs and subscriptions; no platform-charge
  fallback. A direct charge means the Checkout Session is created **as** the
  connected account (`Stripe-Account` request option) with only an application fee
  attached. Adding `transfer_data` would silently make it a destination charge,
  moving the charge, Stripe fees, refunds, and chargebacks onto the platform, so
  the direct-charge adapter is the single place that creates these sessions.
- The `card_payments` capability is what direct charges require; the aggregate
  `charges_enabled` flag alone is not sufficient readiness.
- Full Stripe Dashboard for creators, with summaries and a Dashboard link in Litesubs.
- Stripe bills creators for processing fees and manages connected-account negative
  balance liability under the selected account configuration. Direct charges alone
  do not establish these responsibilities or eliminate all platform obligations.
- Support existing-account connection and new-account onboarding. Verify the current
  supported connection flow and account eligibility before implementing it.
- Platform fee: 2%; persist the agreed subscription fee rate and actual payment fees.
- Monthly subscriptions only. Store the interval explicitly; yearly UI is deferred.
- Monthly credits do not roll over, and recurring plans have no paid top-ups.
- Cancel at period end; allow resume before cancellation takes effect.
- Access and monthly credits last until the paid period ends, including after a
  cancellation request. This standard default supersedes the earlier suggestion
  that cancellation would freeze monthly credits indefinitely.
- Failed renewal payments do not extend the paid period or grant new credits.
  Stripe handles retries; a successful retry grants credits once for the original
  invoice's service period, not a new month beginning at retry time.
- Customer billing portal is scoped to the creator's account. Allow payment-method
  management and invoices; disable plan switching. Keep in-app Cancel / Resume.
- Existing subscribers keep their purchased price and credit allowance.
- Unpublishing stops new sales, not existing renewals. Cancellation is separate.
- Full refunds revoke only remaining credits attributable to the refunded payment.
  Consumed credits remain in history; balances never become negative. Partial
  refunds require an explicit creator credit adjustment. Refund is not cancellation.
- Manual recurring grants expire with the current paid period. Complimentary
  grants without a paid period require an explicit expiry date and do not create
  an automatically renewing free subscription.

These are fixed defaults for v1. Creator-configurable policies can be added later
when there is evidence they are needed.

## Domain model

| Entity | Responsibility |
| --- | --- |
| `connected_accounts` | Creator's Stripe account identity, responsibilities, and payment readiness. |
| `plans` | Editable service identity: name, description, booking integration, availability. |
| `plan_versions` | Immutable published commercial terms: price in minor units, currency, credits, billing mode, interval, and account-scoped Stripe Product/Price references. |
| `enrollments` | Customer-to-plan relationship and credit balance projection. Not recurring billing. |
| `creator_customers` | Local user to Stripe Customer mapping scoped to the connected account. |
| `subscriptions` | Stripe subscription identity, purchased version, fee rate, lifecycle state, and paid-through information. |
| `subscription_invoices` | Account-scoped invoice receipt/idempotency key, paid amount, and the exact service period credited. |
| `payments` | Financial receipts and payment/refund state, with account-scoped Stripe references and actual application fees. |
| `credit_grants` | Granted units, remaining units, source payment or manual adjustment, and expiry. |
| `credit_ledger` | Append-only grants, consumption, expiry, and adjustments; consumption allocations identify the affected grants. |

Retain the connected account identity on account-owned records. Do not derive a
historical payment's account from a creator's current connection: reconnection or
account replacement must not redirect operations to the wrong Stripe account.

Only add fields and tables needed for these responsibilities. Do not duplicate
commercial terms across subscriptions when the immutable version already owns them.
Separate Stripe's reported billing period from the period actually paid and granted.

## Service boundaries

- Thin UI actions, REST routes, and MCP tools call shared domain services.
- A server-only Stripe adapter owns account-scoped API calls and error translation.
- Plan publishing provisions Stripe objects using stable idempotency keys. Local
  drafts are allowed before onboarding; published versions require successful
  provisioning and payment readiness. No half-provisioned offer is purchasable.
- One checkout service serves self-service purchases, creator enrollment, and
  customer-specific payment requests. Prefer authenticated, single-use Checkout
  Sessions over duplicating customer-specific logic in reusable Payment Links.
- Credit services own consumption, expiry, grants, and refund-related revocation
  across UI, API, MCP, and booking integrations.
- Stripe remains authoritative for billing state and money movement; the local
  credit ledger remains authoritative for units of service.

## Reliable fulfillment

- Verify webhook signatures and resolve the connected account from event context.
- Handle one-time Checkout completion and asynchronous payment success, granting
  only when payment is confirmed. Never fulfill from the success page.
- Fulfill recurring allowances from eligible paid subscription invoices, not from
  Checkout completion as well. Do not grant extra allowances for proration invoices.
- Use invoice line/service-period information for the purchased subscription item;
  do not assume the invoice's top-level period describes the entitlement period.
- Database-enforced fulfillment keys prevent concurrent deliveries from granting
  twice. Persist payment receipts even when their service periods have expired.
- Lock the enrollment/grants and atomically commit payment fulfillment, grants,
  balance updates, and ledger entries. Expired or older periods cannot restore an
  allowance or overwrite a newer paid allowance.
- Enforce expiry in the credit service at read/consumption time, independently of
  webhook timing. Scheduled cleanup can materialize expiry ledger entries but must
  not be the sole access-control mechanism.
- Mirror subscription changes without assuming event delivery order. Recover
  current Stripe state where necessary, using the owning account's context.
- Reconcile refunds against the source payment's grants. Stripe handles financial
  refunds; Litesubs synchronizes payment state and the agreed credit effects.
- Recheck current merchant payment capability before sales. Disconnection or
  restricted capability stops new sales and produces a visible operational warning.

## Greenfield cleanup

There are no customers to migrate. Build a clean schema baseline rather than
maintaining old billing paths or compatibility columns.

- Rename `products` to `plans` and `lite_subscriptions` to `enrollments` throughout
  services, UI, API/MCP documentation, and schema.
- Remove platform wallets, earnings ledger, payout requests/preferences, outbound
  payment handlers, and their UI. Creator payouts are Stripe's responsibility.
- Remove platform Customer creation from Better Auth, its Stripe client plugin,
  `user.stripeCustomerId`, and the platform customer portal.
- Remove destination-charge checkout logic and legacy purchase webhook branches.
- Replace the existing account-type-driven onboarding with explicit, supported
  Dashboard, fee-collection, and negative-balance responsibility configuration.
  Use current Stripe account APIs for newly provisioned accounts and verify the
  existing-account authorization flow separately.
- Remove obsolete env settings and document the webhook endpoints/signing secrets
  required by the selected account API and connected-account payment events.
- Regenerate the Drizzle baseline. This is not permission to erase an arbitrary
  database: confirm the exact database/environment before any destructive reset.

## Implementation sequence

Implement the vertical slices below in dependency order. Each slice owns its
necessary schema, services, transport, UI, documentation, and behavior checks;
there is no separate "build all tables," "build all APIs," or "add all tests" ticket.
Add schema only as the consuming behavior lands. Regenerate the greenfield
baseline as needed rather than preserving the old billing model.

Verification must exercise actual service/database behavior for duplicate and
concurrent fulfillment, out-of-order invoices, expiry without a webhook, delayed
payments, cancellation/resume, grandfathered terms, partial consumption followed
by full refund, tenant/account isolation, and recoverable provisioning failures.

## Deferred

Yearly offers, upgrades/downgrades and proration, rollover/top-up options,
creator-configurable fee/expiry/refund rules, automatic import of arbitrary Stripe
catalogs, and custom billing/retry/payout engines. Stripe already owns the standard
billing and payment operations; do not rebuild them in Litesubs.

## Draft issue breakdown

These are local issue drafts, not published tracker tickets. `S01`–`S15` are stable
plan references; replace dependencies with real issue identifiers only after the
breakdown is approved and tracker issues are created. Apply `needs-triage` when
publishing. No parent tracker issue was supplied.

**AFK** means implementation can proceed without a new product decision. **HITL**
means implementation or completion requires a human-controlled Stripe setup,
eligibility verification, sandbox authorization, or deployment approval—not another
round of product-policy design.

### Roadmap

| Slice | Title | Type | Blocked by | User story |
| --- | --- | --- | --- | --- |
| S01 | Create and edit an unpublished plan | AFK | None | Creator prepares an offer before connecting Stripe. |
| S02 | Onboard a new creator-owned Stripe account | HITL | None | Creator sets up payments and reaches their full Stripe Dashboard. |
| S03 | Connect an existing Stripe business account | HITL | S02 | Creator uses the Stripe account they already operate. |
| S04 | Publish immutable plan versions on the creator account | AFK | S01, S02 | Creator publishes an offer and changes future terms without changing existing sales. |
| S05 | Buy a one-time pack through direct-charge Checkout | AFK | S04 | Customer pays the creator and receives credits once. |
| S06 | Spend credits with attributable, retry-safe debits | AFK | S05 | Creator consumes purchased units without overdrafts or duplicate debits. |
| S07 | Start a monthly subscription and receive its first allowance | AFK | S04, S05, S06 | Customer subscribes to the creator with clear price and expiry. |
| S08 | Renew monthly allowances and enforce unpaid-period expiry | AFK | S07 | Customer receives only the allowance for a paid, unexpired period. |
| S09 | Cancel and resume a subscription at period end | AFK | S08 | Customer stops future billing without losing the already-paid period. |
| S10 | Manage customer billing on the creator's Stripe account | AFK | S07 | Customer updates a card and manages invoices with Stripe. |
| S11 | Invite customers and grant complimentary credits | AFK | S01, S06, S08 | Creator invites customers or grants credits with explicit expiry. |
| S12 | Reflect refunds and revoke only their unused credits | AFK | S06, S08 | Creator refunds a sale without removing unrelated credits. |
| S13 | Show creator sales and customer credit history accurately | AFK | S05, S08, S12 | Both parties can distinguish payments, subscription state, and usable credits. |
| S15 | Handle disconnection while subscriptions are live | AFK | S08, S09 | Creator disconnecting Stripe never leaves customers billed for credits nobody can fulfill. |
| S14 | Verify and launch the clean creator-owned payment flow | HITL | S03, S09, S10, S11, S13, S15 | A new creator and customer complete the supported journeys in the configured environment. |

S01 and S02 can start independently. S03 can proceed alongside S04–S08 after
S02. S09, S10, S11, and S12 can proceed independently once their own blockers land.
S13 is not permission to leave broken summaries in earlier slices: each earlier
slice must update the views needed for its own demo.

### Shared execution rules

- Read `AGENTS.md` and the installed Next.js documentation before writing framework
  code. Follow existing principal/scope enforcement and shared service patterns.
- Preserve unrelated user work, sample/demo mode, authentication, and OAuth/MCP
  boundaries. Do not combine this work with unrelated dependency upgrades.
- Keep `plans:read`, `plans:write`, `customers:read`, `customers:write`,
  `billing:read`, and API-key-only `credits:consume` boundaries meaningful. Do not
  expose financial mutations to machine consumption keys.
- Every slice updates its applicable REST/MCP contracts and tests alongside UI.
  Session-only customer actions stay customer-authorized; do not invent creator
  permissions to let a customer manage another person's subscription.
- Test business outcomes through real services/database transactions and suitable
  Stripe adapter boundaries. Sandbox checks complement, not replace, deterministic
  duplicate/concurrency/account-isolation checks. Follow the test-audit skill when
  authoring tests; do not introduce public test-only production hooks.
- Store money in integer minor units, currencies explicitly, and periods as UTC
  instants. Return unambiguous money units through API/MCP responses and docs.
- Use stable database constraints and Stripe idempotency keys for operations with
  external effects. A local transaction cannot roll back a successful Stripe call.
- Incrementally retire superseded code; do not leave destination charges or
  platform-payout fallbacks reachable between slices. Incomplete purchase features
  remain unavailable outside the sandbox until their fulfillment/lifecycle slices
  land. No migration compatibility work is required.
- New-account creation and existing-account connection may use different supported
  Stripe mechanisms. Do not force existing accounts through new-account creation
  or claim their responsibility settings can be changed arbitrarily.
- Never request secrets in source, issue bodies, logs, or chat. Use the approved
  secret-delivery mechanism and keep sandbox and live credentials separate.
- Regenerate a clean schema baseline, but do not reset any database without
  confirmation of the exact environment and scope. Do not rewrite an applied
  baseline underneath a running deployment.
- The Cal.com webhook currently authenticates requests but does not deduct credits.
  These slices preserve the booking link and make the shared credit service ready;
  implementing automatic Cal.com booking consumption is a separate integration
  task. Hiding a Book button is not server-side enforcement of an external booking.

### S01 — Create and edit an unpublished plan

**Type:** AFK

**User story:** As a creator, I can prepare an offer before completing Stripe onboarding.

#### What to build

Make the existing Create Plan flow produce a local draft that is visible and
editable but not purchasable. Introduce `plans` and `enrollments` as the real domain
names throughout the paths this flow touches. Separate editable service identity
from commercial draft terms without prematurely provisioning Stripe objects.
The same draft behavior must be available through the shared plan service,
creator REST endpoints, and creator MCP tools.

#### Acceptance criteria

- [x] A creator without Stripe can create, list, inspect, and edit a draft through
      the UI and authorized plan APIs/tools.
- [x] Draft terms include billing mode, currency, price, credits, and interval;
      monthly is the only recurring interval offered. Invalid input fails clearly.
- [x] Drafts show a Draft badge and an explanation that publishing requires Stripe.
      Invitations and direct checkout calls cannot bypass unpublished status.
- [x] UI/schema/service names distinguish plans and enrollments from subscriptions.
      New code no longer calls a credit balance a billing subscription.
- [x] Plan resolution remains creator-scoped; another creator cannot read or edit
      the draft by guessing its ID. Sample mode is not broken by the rename.
- [x] No draft operation invokes Stripe or creates a platform Customer.

#### Implementation notes and relevant files

Start with `app/db/schema.ts`, `lib/services/plans.ts`, `lib/schemas.ts`,
`app/api/v1/[...resource]/route.ts`, `lib/mcp-tools.ts`, `hooks/use-products.ts`,
`app/dashboard/packs/*`, `app/actions/products.ts`, and `lib/sample-data.ts`.
Move user-facing navigation toward Plans without preserving a legacy payment
path. Review old `/api/products` handlers so they cannot bypass draft checks.
Update the schema baseline for this slice's changes; do not build unused payment
or subscription tables as a prerequisite for this draft-only flow.

#### Verification / demo

With a fresh creator and no Stripe connection, create and edit a draft, find it
through REST/MCP, and demonstrate a direct purchase request being rejected.
Verify cross-creator isolation and validation through the real plan service.

#### Blocked by

None — can start immediately.

### S02 — Onboard a new creator-owned Stripe account

**Type:** HITL

**User story:** As a creator without Stripe, I can set up payments for my own business
and manage them in the full Stripe Dashboard.

#### What to build

Replace the Express/platform-payout setup with new merchant onboarding configured
for full Dashboard access, Stripe-billed processing fees, Stripe-managed negative
balance liability, and direct charges. Persist the account identity and actual
readiness state. Provide a clear creator setup/status screen and Dashboard access.
Retire the old platform payout experience as part of this user journey.

#### Acceptance criteria

- [x] Onboarding uses current supported Stripe account APIs and explicitly requests
      the agreed responsibilities; no legacy account-type assumption substitutes
      for checking them.
- [x] A creator can start/retry/return from onboarding without duplicate accounts;
      incomplete onboarding remains visible and does not mark payments ready.
- [x] Payment readiness reflects the required merchant capability, not just whether
      a local account row exists. Requirement changes are surfaced with a remedial
      action using supported hosted/embedded Stripe components.
- [x] Full Dashboard access is available once applicable. Displayed responsibility
      wording does not promise that Litesubs has no legal obligations.
- [x] Platform payout requests, payout preferences, earnings-wallet UI, and outbound
      payment handlers are removed with their dead models/services/tests/docs.
- [x] No sales action falls back to platform charges when readiness is missing.
- [ ] The operator verifies the sandbox configuration, supported regions, webhook
      setup, and the resulting Dashboard/fee/negative-balance responsibilities.

#### Implementation notes and relevant files

Start with `app/actions/stripe-connect.ts`, `app/db/stripe-connect-schema.ts`,
`components/stripe-connect/*`, `components/app-sidebar.tsx`,
`app/dashboard/payouts/page.tsx`, `app/db/payouts-schema.ts`,
`app/actions/payouts.ts`, `app/actions/payout-preferences.ts`, `lib/payouts.ts`,
`components/payouts/*`, and `PAYOUTS.md`. Keep Stripe adapter code server-only.
Account readiness events must match the chosen account API's event format; do not
reuse snapshot account handlers for thin events without fetching their objects.

#### Verification / demo

Complete new-account onboarding in an isolated sandbox, open the full Dashboard,
and demonstrate incomplete/restricted readiness preventing a sale. Verify retry
and return-state authorization. Human participation is for Stripe setup and
configuration verification, not for revisiting the product decisions.

#### Blocked by

None — can start immediately.

### S03 — Connect an existing Stripe business account

**Type:** HITL

**User story:** As a creator who already uses Stripe, I can connect that business
without being forced to create another account.

#### What to build

Add the supported existing-account connection flow beside new-account onboarding.
Resolve and persist the authorized account after the callback, show its readiness,
and provide Dashboard access using the same creator-facing status model as S02.
Verify the existing-account flow against current Stripe documentation and actual
platform eligibility before committing to a particular authorization mechanism.

#### Acceptance criteria

- [ ] The setup screen clearly offers existing-account connection versus new-account
      onboarding. Existing-account connection does not create another business.
- [ ] Authorization callbacks bind to the initiating creator, validate state, reject
      replay/forgery, and do not leak credentials or authorization codes.
- [ ] The connected account's Dashboard and responsibility configuration is checked
      for compatibility. Incompatible accounts receive an actionable explanation,
      not silent changes or a destination-charge fallback.
- [ ] Connection cancellation/failure is recoverable without falsely reporting success.
- [ ] Disconnection disables new sales and surfaces a warning. Account-owned payment
      and subscription records retain their original account identity.
- [ ] Reconnecting the same account restores the mapping safely. Switching to a
      different account with existing subscriptions is not silently supported;
      explain that this requires separate handling.
- [ ] A human verifies platform authorization/eligibility and the existing-account
      sandbox journey. Any provider limitation is recorded as a concrete blocker.

#### Implementation notes and relevant files

Extend the connection service/UI introduced in S02, `lib/stripe.ts`, and the
connected-account persistence model. Callback routes and authorization storage
must follow the documented flow rather than speculative Accounts v2/OAuth mixing.
Do not store account access tokens in the generic end-user social-login tables.

#### Verification / demo

Connect an existing sandbox business, open its Dashboard, then disconnect and
reconnect it. Check failed/cross-user callbacks, mismatched account identity,
revoked authorization, and secret redaction.

#### Blocked by

- S02 — Onboard a new creator-owned Stripe account.

### S04 — Publish immutable plan versions on the creator account

**Type:** AFK

**User story:** As a creator, I can publish my draft and change future offers without
silently changing what existing customers bought.

#### What to build

Publish a draft by provisioning its Product/Price on the ready connected account
and committing an immutable `plan_version`. Let creators edit service metadata,
prepare replacement commercial terms, publish a new version, and unpublish the
offer. Initial availability can be restricted to one-time plans until S07 adds
the full monthly purchase path.

The publication lifecycle ships on every transport in the same slice, including
two creator MCP tools: `publish_plan` and `unpublish_plan`. Do not land this as a
dashboard-only action; `enroll_customer` already rejects drafts with
`PLAN_NOT_PUBLISHED`, so an MCP-only creator is otherwise stuck at a dead end
with no way to publish and no tool to explain why.

#### Acceptance criteria

- [x] Publishing requires current merchant readiness and positive purchasable terms
      compatible with Stripe's minimum amount/currency rules. Complimentary
      enrollment remains separate from a zero-price paid offer.
- [x] Product/Price objects are created on the creator account, not the platform;
      a published version records that account and immutable commercial terms.
- [x] Retries/concurrent publishing attempts use stable idempotency and constraints;
      a timeout after Stripe succeeds is recoverable without duplicate offers.
- [x] Failed provisioning leaves an actionable draft/retry state, never a published
      row with missing Stripe references or a half-sellable version.
- [x] Editing price/credits/mode/interval creates new terms rather than mutating an
      already-published version; service name/description edits remain distinct.
- [x] Unpublish disables new sales without deleting Stripe subscriptions, credit
      grants, purchased versions, or their history.
- [x] UI, REST, and creator MCP expose the same publication lifecycle and errors;
      other creators cannot publish/edit this plan.
- [x] `publish_plan` and `unpublish_plan` exist as MCP tools under `plans:write`,
      with the same readiness, idempotency, and provisioning errors as the UI.
      An ambiguous plan name returns candidates instead of guessing, as the other
      plan tools do.
- [x] Unpublishing over MCP requires an explicit confirmation input, matching the
      confirmation the UI asks for, so a model cannot stop sales by accident.

#### Implementation notes and relevant files

Extend S01's plan service, plan dialogs/actions, `app/db/schema.ts`,
`lib/mcp-tools.ts`, `app/api/v1/[...resource]/route.ts`, and the Stripe adapter.
Separate local draft edits from publication. Use a bounded retry-safe publishing
operation, not a general-purpose workflow engine. Treat archived/missing Stripe
objects as a clear purchase/provisioning problem; do not auto-import arbitrary
creator catalog entries.

#### Verification / demo

Publish an offer and inspect its Stripe objects on the creator account. Publish a
replacement and show the previous version remains immutable. Inject a provisioning
timeout and retry; assert one published version and one set of intended objects.

**Implemented:** yes — see `lib/services/publish.ts`,
`lib/stripe-offers.ts`, and `drizzle/0004_plan_publication.sql`.

#### Blocked by

- S01 — Create and edit an unpublished plan.
- S02 — Onboard a new creator-owned Stripe account.

### S05 — Buy a one-time pack through direct-charge Checkout

**Type:** AFK

**User story:** As a customer, I pay the creator for a pack and see the purchased
credits after confirmed payment, without duplicate grants.

#### What to build

Deliver the first complete creator-owned purchase: one shared Checkout service,
an account-scoped Stripe Customer mapping, direct payment with a 2% application
fee, signed connected-account fulfillment, a payment receipt, and a source-linked
credit grant displayed in the customer enrollment. Route self-service and
customer-specific purchase requests through the same service.

#### Acceptance criteria

- [x] Only a published, available version on a payment-ready account is purchasable.
      The requested customer/version/creator ownership is validated server-side.
- [x] Concurrent first purchases reuse one intended Customer per local customer and
      connected account. A platform Customer is never passed to that account.
- [x] Checkout uses direct charges and the agreed 2% rounded application fee, with
      no `transfer_data` or platform fallback; persist actual paid amounts/fees.
- [x] A paid pack creates an enrollment as needed, one payment receipt, one credit
      grant, and its ledger entry atomically. Rebuying adds a separate grant.
- [x] Fulfillment is signature-verified and account-bound; unpaid Checkout completion
      grants nothing, asynchronous success fulfills once, and duplicate/concurrent
      deliveries cannot produce duplicate units or receipts.
- [x] Expired/failed Checkout attempts are visible without granting units. The success
      page tolerates webhook delay and does not itself grant credits.
- [x] Creator-generated customer purchase requests use single-use authenticated
      checkout handling rather than reusable links containing another user's identity.
- [x] Remove platform Customer signup, `user.stripeCustomerId`, Better Auth's obsolete
      Stripe server/client plugins, platform portal code, and destination-charge
      handlers without breaking normal authentication.

#### Implementation notes and relevant files

Start with `app/actions/stripe.ts`, `lib/services/enroll.ts`,
`app/api/webhooks/stripe/route.ts`, `components/buy-button.tsx`,
`hooks/use-transaction-check.ts`, `app/dashboard/subscriptions/[subscriptionId]/page.tsx`,
`lib/auth.ts`, `lib/auth-client.ts`, and `app/db/auth-schema.ts`.
Introduce `creator_customers`, `payments`, `credit_grants`, and the minimal ledger
needed for this flow. Store Checkout/PaymentIntent/account correlation locally;
metadata is correlation data, not sufficient authorization to grant credits.
Stripe API calls must use the installed SDK's actual parameter shapes.

#### Verification / demo

Buy a sandbox pack, wait for fulfillment, and show the receipt and grant. Buy
again without creating another Stripe Customer. Exercise async payment, invalid
signatures, concurrent webhook deliveries, and a wrong-account event. Confirm
the charge belongs to the creator and the application fee belongs to Litesubs.

**Implemented:** yes — see `lib/services/purchase.ts`,
`lib/stripe-direct-charges.ts`, `drizzle/0005_s05_purchase.sql`, and
`app/pay/[token]/page.tsx`.

#### Blocked by

- S04 — Publish immutable plan versions on the creator account.

### S06 — Spend credits with attributable, retry-safe debits

**Type:** AFK

**User story:** As a creator, I can consume a customer's purchased units and trust
that retries or simultaneous usage will not overspend them.

#### What to build

Replace undifferentiated balance writes with grant-aware consumption. Allocate
each debit to available source grants, maintain the enrollment balance projection,
and record before/after receipts and allocations atomically. Apply this through
the consumption API/MCP machine tool and the existing authorized creator decrease
action; show the resulting history in the enrollment detail.

#### Acceptance criteria

- [x] Consumption spends only usable grants, using a documented deterministic order:
      earliest expiry first, then oldest grant; non-expiring grants come last.
- [x] The request either allocates the entire debit or fails without partial effects.
      Grant remaining amounts and the enrollment projection cannot become negative.
- [x] Duplicate idempotency keys replay the original receipt; conflicting payloads
      fail. Concurrent different debits serialize correctly, including a debit
      that spans more than one purchased pack.
- [x] Reads/debits exclude expired grants even without a scheduled expiry job.
      Materialized expiry ledger entries are themselves retry-safe.
- [x] Dry runs have no durable effects or key reservations and report the current
      usable balance without consuming grants.
- [x] API-key consumption retains `credits:consume` restrictions; creator adjustments
      keep their separate authorization. Other creators cannot debit the enrollment.
- [x] Ledger history identifies usage, its source allocations, and before/after
      usable balances rather than mixing the debit with a financial payment.

#### Implementation notes and relevant files

Start with `lib/services/credits.ts`, `lib/services/customers.ts`,
`app/actions/customers.ts`, `app/dashboard/customers/decrease-credit-button.tsx`,
`app/actions/transactions.ts`, the enrollment ledger page, REST credits routes,
and `lib/mcp-tools.ts`. Preserve the existing idempotency/dry-run guarantees while
moving them to the credit ledger. All balance mutators must use the same locking
and allocation rules; no direct update escape hatches.

#### Verification / demo

Buy two packs, consume across their grants, replay the debit, and demonstrate an
overdraft rejection and concurrent-debit correctness. Advance the test clock past
a grant expiry and verify consumption fails without relying on a webhook/job.
Automatic Cal.com booking consumption is not included in this slice.

**Implemented:** yes — see `lib/services/credits.ts`,
`drizzle/0006_s06_credit_grants.sql`, and `lib/credits.integration.test.ts`.

Spend order is expiry-soonest first, then non-expiring oldest first. Expiry is
enforced on read (`usableBalance`/allocation ignore past-boundary grants), so
correctness never depends on a scheduled job; `expireGrants` only materializes
ledger rows and is itself idempotent.

#### Blocked by

- S05 — Buy a one-time pack through direct-charge Checkout.

### S07 — Start a monthly subscription and receive its first allowance

**Type:** AFK

**User story:** As a customer, I subscribe to the creator and receive the allowance
for my first paid month with a clearly stated expiry date.

#### What to build

Enable monthly plan publication and subscription Checkout on the creator account.
Persist a `subscription` linked to the purchased immutable version and account,
and fulfill the first allowance from its paid invoice. Display the monthly price,
usable credits, payment state, and paid-through date in creator/customer views.

#### Acceptance criteria

- [x] Monthly publication creates an account-scoped recurring Stripe Price; customers
      see `/month`, the credit allowance, automatic renewal, and no-rollover expiry
      before authorizing payment.
- [x] Checkout uses `mode: subscription`, the creator-scoped Customer, and a 2%
      application-fee percentage; persist the agreed rate on the subscription.
- [x] First invoice fulfillment grants exactly one allowance for the subscription
      item's service period. Checkout completion alone does not also grant credits.
- [x] Failed/incomplete startup grants no allowance. A later paid first invoice can
      recover the same intended subscription without duplicate grants.
- [x] Repeated/concurrent start requests do not create multiple live subscriptions
      for the same customer/plan, including the window before webhooks arrive.
- [x] Recurring pages do not offer paid top-ups. A caller cannot bypass this by
      invoking a one-time checkout endpoint with a recurring plan ID.
- [x] The subscription stores reported Stripe state separately from its actually
      paid/granted period. Its first allowance expires at that period's end using
      the shared credit service, even before renewal delivery exists.
- [x] Existing one-time purchase flows remain unchanged. Monthly sales stay sandbox-
      only/unavailable in live mode until the release gate is complete.

#### Implementation notes and relevant files

Extend the shared Checkout/provisioning adapters and invoice webhook dispatcher,
`app/db/schema.ts`, plan creation/detail dialogs, `components/buy-button.tsx`,
customer/enrollment detail pages, and shared plan/enrollment services.
Normalize invoice line data using the pinned SDK/API version; a top-level invoice
period and `amount_paid > 0` alone are not sufficient fulfillment rules. Persist
legitimate zero-total invoice state without fabricating revenue or rejecting a
paid invoice solely because Stripe reports no new cash collected.

#### Verification / demo

Publish a monthly offer, subscribe in the sandbox, and show one creator-owned
subscription plus one period grant. Deliver Checkout and invoice events in either
order, and retry concurrent starts. Verify no top-up path and first-period expiry.

**Implemented:** yes — see `lib/services/purchase.ts`, the Stripe webhook
dispatcher, and `drizzle/0007_s07_subscriptions.sql`. Deterministic PostgreSQL
coverage is in `lib/subscriptions.integration.test.ts` (opt-in).

#### Blocked by

- S04 — Publish immutable plan versions on the creator account.
- S05 — Buy a one-time pack through direct-charge Checkout.
- S06 — Spend credits with attributable, retry-safe debits.

### S08 — Renew monthly allowances and enforce unpaid-period expiry

**Type:** AFK

**User story:** As a customer, I receive a new allowance only for a paid month;
unused monthly credits do not roll over or remain usable after payment stops.

#### What to build

Handle subscription-cycle invoices and payment failures using Stripe's normal
renewal/retry schedule. Expire old period grants at their real boundary, grant
the purchased version's allowance once for each eligible paid service period,
and expose paid-through/overdue information through UI and APIs.

#### Acceptance criteria

- [x] A paid renewal creates a new period grant for the purchased version's credits;
      old unused units expire rather than accumulating.
- [x] Current Stripe billing-state updates cannot advance entitlement before an
      invoice is actually fulfilled. Access is based on paid, usable grants.
- [x] Failure grants nothing and does not extend the previous paid-through date.
      Stripe—not a custom cron—owns payment retries and terminal billing state.
- [x] A successful retry grants the original invoice period once, with its original
      end; a payment received after that end records financial truth but creates
      no spendable expired allowance.
- [x] Duplicate, concurrent, and out-of-order invoice delivery cannot wipe newer
      credits, reopen an expired period, or grant the same period twice. Invoices
      for unrelated items or unsupported proration changes do not add allowances.
- [x] New plan versions affect only new subscriptions. Existing subscribers renew
      with their original price/credits and agreed application-fee rate.
- [x] UI, read APIs, consumption, and billing summaries agree about overdue state and
      usable units without needing timely cleanup or lifecycle webhook delivery.

#### Implementation notes and relevant files

Extend invoice fulfillment, the subscription service, grant expiry, consumption,
dashboard queries, and customer detail UI. Use the subscription item's service
period and immutable version, not mutable plan terms or the mirror's latest
reported `current_period_start`. Keep financial receipt recording distinct from
whether a late invoice can still create usable credits.

#### Verification / demo

Advance a sandbox/test clock through a successful renewal, a failed renewal, and
a successful retry. Check missing/delayed/out-of-order events, a late payment for
an already-expired period, and a price/credit edit while an old subscriber renews.
Verify the actual service/database outcomes, not only helper calculations.

**Implemented:** yes — see `markSubscriptionInvoiceFailed` and
`fulfillSubscriptionInvoice` in `lib/services/purchase.ts`, connected invoice
handling in `app/api/webhooks/stripe/route.ts`, and
`drizzle/0008_s08_renewals.sql`. Database-backed coverage extends
`lib/subscriptions.integration.test.ts` (opt-in).

#### Blocked by

- S07 — Start a monthly subscription and receive its first allowance.

### S09 — Cancel and resume a subscription at period end

**Type:** AFK

**User story:** As a customer, I can stop future renewals while keeping the paid
month, or resume before the cancellation takes effect.

#### What to build

Add customer-authorized Cancel / Resume actions to subscription detail views,
calling Stripe on the subscription's owning account. Mirror scheduled cancellation
and terminal state from authoritative Stripe responses/events. Support a new
purchase after final cancellation without reusing the dead Stripe subscription.

#### Acceptance criteria

- [x] Cancel sets `cancel_at_period_end`, shows the effective date, and does not
      immediately revoke the paid period's remaining credits.
- [x] Credits still expire at the paid period end; cancellation does not turn them
      into permanent credits. No further allowance is granted without a new payment.
- [x] Resume before final cancellation clears the flag on the same subscription,
      with no duplicate subscription, checkout, payment, or allowance.
- [x] After terminal cancellation, a new subscription uses a new billing identity
      while retaining the enrollment, original receipts, and expired credit history.
- [x] Customer ownership and account scope are enforced server-side. Retries and
      creator-side Stripe Dashboard cancellations converge to correct local state.
- [x] Unpublishing a plan does not cancel existing subscriptions; existing customers
      can manage them even when new purchases are unavailable.
- [x] An unavailable/disconnected account yields a clear failure, never a misleading
      successful local cancellation when Stripe was not updated.

#### Implementation notes and relevant files

Implement thin customer actions over the subscription service and account-scoped
adapter. Update `app/dashboard/subscriptions/[subscriptionId]/page.tsx` or its
renamed equivalent and customer cards. Resolve current state where stale events
would otherwise reverse cancellation/resume; do not build a custom scheduler.

#### Verification / demo

Subscribe, cancel, consume during the remaining paid period, resume, and finally
cancel through period end. Show expiry and a clean new subscription on repurchase.
Repeat actions and attempt them as a different customer.

**Implemented:** yes — see `updateCustomerSubscriptionCancellation` and
`syncSubscriptionFromStripe` in `lib/services/subscriptions.ts`, the connected
subscription adapter and lifecycle webhook handlers, and
`drizzle/0009_s09_cancellation.sql`. Database-backed coverage is part of
`lib/subscriptions.integration.test.ts` (opt-in).

#### Blocked by

- S08 — Renew monthly allowances and enforce unpaid-period expiry.

### S10 — Manage customer billing on the creator's Stripe account

**Type:** AFK

**User story:** As a customer, I can replace a card and view/pay invoices for the
specific creator I subscribe to without Litesubs collecting payment details.

#### What to build

Add Manage billing on each subscription, creating a Stripe-hosted billing portal
session on the owning creator account for the matching mapped Customer. Keep
Cancel / Resume in Litesubs and do not offer a platform-wide portal pretending
all creator subscriptions belong to one Stripe Customer.

Per Stripe's Connect guidance, portal **configuration** is created for the
platform and referenced by the session; the session itself is created against the
connected account's Customer. Verify this combination in a sandbox before relying
on per-account portal settings.

#### Acceptance criteria

- [x] The portal session is created on the stored owning account for the authenticated
      subscriber's mapped Customer, not the platform or another creator's account.
- [x] Customers can update payment methods and use Stripe's supported invoice
      management/payment flows. Billing data from another creator is never exposed.
- [x] Portal configuration disables plan switching and other unsupported term
      changes so it cannot bypass published versions and credit entitlement rules.
- [x] The portal configuration is created through the API for the platform and
      referenced explicitly by each session, because Stripe documents that portal
      configuration is not configured per connected account. Provisioning is
      idempotent and does not assume a Dashboard-created configuration applies.
- [x] The return URL is trusted and points back to the appropriate Litesubs view.
      Missing mappings/unavailable accounts produce actionable errors.
- [x] UI distinguishes the customer billing portal from the creator's full Dashboard;
      no card data or sensitive portal URLs are logged or stored unnecessarily.

#### Implementation notes and relevant files

Start with the replacement for `createCustomerPortalSession` in
`app/actions/stripe.ts`, the subscription service, account/customer mapping,
subscription detail UI, and `app/dashboard/account/page.tsx`. Account page should
link customers to their creator-specific billing relationships, not recreate a
global platform Customer.

#### Verification / demo

Subscribe to two different creators and open each portal. Confirm account/customer
isolation, card replacement, invoice access, disabled plan switching, and safe return.
Record which portal features the platform configuration actually exposes for a
connected-account Customer; any unsupported feature is a documented limitation
rather than a silent gap.

**Implemented:** yes — see `lib/stripe-billing-portal.ts`,
`lib/services/billing-portal.ts`, `app/actions/subscriptions.ts`, and the Account
and enrollment detail views. PostgreSQL-backed account-isolation coverage extends
`lib/subscriptions.integration.test.ts` (opt-in). The actual Connect portal
configuration/session combination still needs sandbox verification before live
release.

#### Blocked by

- S07 — Start a monthly subscription and receive its first allowance.

### S11 — Invite customers and grant complimentary credits

**Type:** AFK

**User story:** As a creator, I can invite a customer to buy or grant complimentary
credits, with understandable expiry and no accidental recurring billing.

#### What to build

Adapt the existing invitation, invoice-enrollment, comp-enrollment, and manual
adjustment journeys to published versions and source-tracked credit grants.
Invitation acceptance establishes the enrollment; paid units still come only
from payment fulfillment. Complimentary units are explicit grants, not Stripe
subscriptions or hidden free recurring plans.

#### Acceptance criteria

- [x] A purchase invite targets an available published offer; accepting it creates
      no paid allowance until the correct Checkout/invoice fulfillment occurs.
- [x] Comp grants require a reason, record source/expiry, and are applied exactly
      once on claim. Invite terms do not silently change after being issued.
- [x] Extra credits for a recurring enrollment with a current paid period inherit
      its end; without a paid period, an explicit future expiry is required.
- [x] UI/REST/MCP expose the same expiry rules and show expiry before grant/claim.
      Complimentary enrollment does not create automatic monthly grants.
- [x] Manual decreases use attributable debit logic; manual increases create grants.
      Neither mutates a Stripe invoice, subscription price, or paid-through date.
- [x] Existing email matching, invite expiry, tenant scoping, reason requirement,
      duplicate-claim protection, and truthful "no email sent" messaging remain.
- [x] Unpublished/unavailable paid offers cannot be resurrected by an old invite;
      comp and payment requests are clearly distinguished in the UI.

#### Implementation notes and relevant files

Start with `lib/services/enroll.ts`, `lib/services/credits.ts`,
`app/actions/invites.ts`, `app/invite/[token]/*`,
`app/dashboard/creator/invite-user-dialog.tsx`,
`app/dashboard/customers/manage-enrollment-credits-dialog.tsx`, and enrollment
REST/MCP contracts. Replace mutable-plan credit reads with snapshotted/versioned
terms for issued offers. Keep invitation claim and grant ledger insertion atomic.

#### Verification / demo

Invite an unknown email, claim once, and buy the intended offer. Separately claim
a comp invite, grant an extra monthly unit, and show its period-bound expiry.
Verify missing expiry is rejected without a paid period and concurrent claims
cannot duplicate credits.

**Implemented:** yes — `resolveGrantExpiry` in `lib/services/credits.ts` owns the
expiry rule for comps and manual increases; `plan_version_id`/`comp_expires_at` on
`invites` pin the issued offer and its stated expiry; and the claim path refuses a
superseded version. Migration: `drizzle/0010_s11_invites.sql`. Coverage lives in
`lib/mcp.integration.test.ts` and `lib/migrations.test.ts` (opt-in).

#### Blocked by

- S01 — Create and edit an unpublished plan.
- S06 — Spend credits with attributable, retry-safe debits.
- S08 — Renew monthly allowances and enforce unpaid-period expiry.

### S12 — Reflect refunds and revoke only their unused credits

**Type:** AFK

**User story:** As a creator, I refund through Stripe and Litesubs removes only the
unspent units from the fully refunded purchase, preserving accurate history.

#### What to build

Reconcile successful connected-account refunds with the corresponding payment
and source grants. Show partial/full refund status and resulting revocation in
creator/customer history. Refund operations remain in the creator's Stripe
Dashboard; Litesubs does not build a competing financial-refund UI in this slice.

#### Acceptance criteria

- [x] Successful full refunds revoke only the remaining units attributable to that
      payment, not credits from a different pack, newer period, or manual grant.
- [x] Consumed units stay in the ledger; zero remaining units create no negative
      balance or fictional debt. Already-expired units are not removed twice.
- [x] Partial refunds update financial totals/history and visibly require a creator
      credit adjustment; no guessed money-to-lessons conversion is applied.
- [x] Multiple successful partial refunds reaching the full payment amount trigger
      the full-refund rule exactly once. Pending/failed refunds do not prematurely
      revoke units or report refunded money as final.
- [x] Duplicate/concurrent/out-of-order refund notifications and a refund racing
      consumption cannot corrupt grant allocations or balance projections.
- [x] Financial receipt state and revocation commit coherently; retry after a crash
      converges without duplicating effects. Refunds arriving before purchase
      fulfillment cannot later leave spendable refunded credits.
- [x] Refunding a monthly invoice does not cancel the subscription. Future paid
      periods remain independent, and revocation targets the refunded period only.
- [x] Display actual refunded money and application-fee state; do not assume Stripe
      automatically refunds the platform's fee in every refund operation.

#### Implementation notes and relevant files

Extend the connected-account webhook dispatcher, payments/refund reconciliation,
grant/ledger service, and creator/customer history views. Resolve the originating
payment through stored account-scoped Stripe references; never trust a current
plan balance as a substitute for source attribution. Fetch current refund/payment
state when event ordering makes individual payloads insufficient.

#### Verification / demo

Buy two packs, spend from one, refund it fully in Stripe, and show the other pack
untouched. Check partial refunds, cumulative full refunds, recurring invoice
refunds, concurrent consumption, duplicate notifications, and refund-before-grant
delivery. No new subscription cancellation should appear.

**Implemented:** yes — `lib/services/refunds.ts` owns refund reconciliation and
revocation; `charge.refunded` lists refunds on the owning account so each is
deduplicated by its own id. Migration: `drizzle/0011_s12_refunds.sql`. Coverage:
`lib/refunds.integration.test.ts` and `lib/migrations.test.ts` (opt-in).
Refund receipts store the actual refunded amount; partial refunds return
`requiresAdjustment` so a creator chooses any credit adjustment explicitly.

#### Blocked by

- S06 — Spend credits with attributable, retry-safe debits.
- S08 — Renew monthly allowances and enforce unpaid-period expiry.

### S13 — Show creator sales and customer credit history accurately

**Type:** AFK

**User story:** As a creator or customer, I can understand money paid, refunds,
subscription state, and usable credits without conflating them.

#### What to build

Finish the unified read experience across creator overview, plan/customer detail,
customer dashboard, and enrollment history using the new payment and credit
sources. Keep summaries in Litesubs and full financial operations in Stripe.
Include useful empty/setup states and preserve isolated sample/demo data.

#### Acceptance criteria

- [x] Creator sales and customer spending derive from confirmed payments and refunds,
      not current plan prices or counts of credit-ledger entries. Pending Checkout
      and manual grants do not inflate sales.
- [x] Mixed currencies are grouped or clearly separated; USD and EUR are never added
      into a single unlabeled monetary total. Fees and gross/net/refunded values
      are labeled rather than presented as a fictional Litesubs payout balance.
- [x] Enrollment counts, active Stripe subscriptions, scheduled cancellations,
      payment failures, and usable credit totals remain separate concepts.
- [x] History distinguishes payment receipts from credit grants, usage, expiry,
      and revocation; users can relate a credit effect to its originating purchase.
- [x] Monthly prices/allowances/expiry dates and grandfathered purchased terms are
      shown correctly even after a new version is published or the plan is unlisted.
- [x] Creator Dashboard access and customer Manage billing links point to their
      respective Stripe contexts; restricted/disconnected state is visible.
- [x] REST/MCP read contracts and sample/demo screens reflect the same vocabulary
      and accounting definitions without leaking another tenant's/customer's data.

#### Implementation notes and relevant files

Start with `app/actions/dashboard.ts`, `lib/services/customers.ts`,
`app/actions/customers.ts`, `app/actions/transactions.ts`,
`components/consumer-stats-cards.tsx`, `components/section-cards.tsx`,
`components/pack-item.tsx`, creator/customer dashboard views, `lib/sample-data.ts`,
and `docs/MCP.md`. Do not hold all read-side fixes until this slice: concentrate
here on the coherent cross-flow overview and historical reporting experience.

#### Verification / demo

Use a dataset with two currencies, packs, a grandfathered subscription, renewal,
refund, manual grant, and scheduled cancellation. Trace displayed totals to the
stored receipts/ledger and demonstrate tenant/customer isolation plus sample mode.

**Implemented:** yes — `lib/services/reporting.ts` is the single money read model
over `payments` and `subscription_invoices` (gross, refunded, net, platform fees,
grouped per currency). Creator, customer, plan-detail, and customer-detail views
use it; `money` is also exposed on the `list_customers`/`get_customer` MCP tools
and REST customer reads. Credits, subscriptions, and money stay distinct fields.
Coverage: `lib/reporting.integration.test.ts` (opt-in).

#### Blocked by

- S05 — Buy a one-time pack through direct-charge Checkout.
- S08 — Renew monthly allowances and enforce unpaid-period expiry.
- S12 — Reflect refunds and revoke only their unused credits.

### S15 — Handle disconnection while subscriptions are live

**Type:** AFK

**User story:** As a customer, I am never billed by a creator whose Stripe account
can no longer serve me, and I can see what happens to my remaining credits.

#### What to build

Make disconnection subscription-aware. Stripe does not cancel subscriptions when a
platform disconnects, so Litesubs must decide and enforce what happens to live
subscriptions on that account instead of silently keeping them billing.

#### Acceptance criteria

- [ ] Disconnect enumerates the creator's **live** subscriptions from Litesubs'
      own records (not by scanning Stripe) and refuses to complete silently while
      any remain unhandled.
- [ ] The creator is told exactly how many subscriptions are live and given a
      supported choice: cancel them at period end, or keep the connection until
      they end.
- [ ] Cancellation performed for this reason sets `cancel_at_period_end` on the
      owning account and is recorded with its cause, so it is never confused with a
      customer-initiated cancellation in S09.
- [ ] Access and already-granted credits still run to the end of each paid period;
      disconnect never revokes a paid period early or refunds it implicitly.
- [ ] No further allowance is granted after the final paid period, and a renewal
      that Stripe still collects (because cancellation failed) does not silently
      grant credits.
- [ ] A deauthorization webhook from the creator's Dashboard triggers the same
      handling, and a failure to reach Stripe leaves a visible, retryable state
      rather than a false "disconnected" success.
- [ ] Customers see an honest status on their subscription instead of a renewal
      date that will not be honoured.
- [ ] One-time-pack purchases are unaffected: they need no cancellation, and their
      remaining credits keep their existing expiry rules.

#### Implementation notes and relevant files

Extend the connected-account service and disconnect action, the subscription
service, the Payments screen, and the deauthorization webhook. Do not build a
scheduler: cancellation is requested at Stripe and mirrored from authoritative
responses/events. Reuse S09's cancel/resume path rather than a second mutation
path, and keep account-owned records bound to their original account identity.

#### Verification / demo

Subscribe, then disconnect with one live subscription. Show the refusal or the
explicit cancellation choice, the period-end cancellation, remaining credits usable
until that date, no post-period allowance, and a clean state after the webhook.
Repeat with the creator cancelling from their own Dashboard.

#### Blocked by

- S08 — Renew monthly allowances and enforce unpaid-period expiry.
- S09 — Cancel and resume a subscription at period end.

### S14 — Verify and launch the clean creator-owned payment flow

**Type:** HITL

**User story:** As a new creator and customer, I can complete the supported journeys
in the deployed environment with correct Stripe ownership and credit behavior.

#### What to build

Run the complete supported journey against the final clean baseline and isolated
Stripe sandbox, document operational setup, and make the deployment ready for
explicit approval. Update the existing smoke tooling to the actual new ownership
model, not a platform payment simulation. This is a deployment/operational journey,
not a ticket to postpone every other slice's tests or rewrite the billing engine.

#### Acceptance criteria

- [ ] A fresh database baseline boots authentication, sample mode, plan drafting,
      connections, purchases, grants, subscriptions, and customer management with
      no dependency on obsolete payout tables or platform Stripe Customers.
- [ ] New/existing creator connection, publication, pack purchase/consumption,
      monthly start/renewal/failure/retry, Cancel/Resume, portal, comp invitation,
      and refund journeys are verified with the correct account and 2% fees.
- [ ] The configured webhook destinations accept required event formats and account
      context; signatures are checked, invalid traffic fails closed, and temporary
      failures can recover through Stripe's normal retry/replay mechanisms.
- [ ] Logs correlate account and Stripe/local object identifiers without logging
      secrets or unnecessary customer data. Operators can distinguish an unpaid
      invoice, failed local fulfillment, and missing account authorization.
- [ ] Setup docs list exact required env keys, scoped permissions, Dashboard
      configuration, portal restrictions, webhook subscriptions, and recovery steps.
      FAQ/landing/MCP docs no longer promise rollover or platform-managed payouts.
- [ ] Typecheck, relevant behavior/integration tests, build, and audit checks pass;
      smoke runs use bounded timeouts and clean up only their own sandbox fixtures.
- [ ] A human confirms the deployment/database target before any reset. If the
      baseline replaces an applied one, rebuild only the confirmed disposable app
      database/environment with the existing reset safeguards; preserve unrelated
      schemas/data and avoid pretending an in-place migration is necessary.
- [ ] Live release is explicitly approved only after required Stripe account and
      webhook/portal configuration is verified. Keep unsupported monthly options,
      policy settings, and automatic Cal.com credit consumption out of the UI/docs.

#### Implementation notes and relevant files

Start with `scripts/smoke-sandbox-checkout.mjs`, `scripts/reset-app-db.mjs`,
`scripts/check-migration-baseline.mjs`, `drizzle/*`,
`.github/workflows/ci.yml`, `.github/workflows/drizzle-migrate.yml`,
`README.md`, `PROJECT.md`, `FAQ.md`,
`app/dashboard/faq/page.tsx`, and `docs/MCP.md`. Keep baseline tooling deliberate;
do not remove its safety checks just to bypass an old hash. Confirm external
Stripe configuration rather than claiming source-code changes configured it.

#### Verification / demo

Capture a concise sandbox run report with account/object identifiers, observed
fees, entitlement dates, and passed scenarios; include known limitations and
the approved environment setup. Human review approves configuration and release,
not secrets in the report. No real customer charge or broad database reset is
authorized merely by this issue's existence.

#### Blocked by

- S03 — Connect an existing Stripe business account.
- S09 — Cancel and resume a subscription at period end.
- S10 — Manage customer billing on the creator's Stripe account.
- S11 — Invite customers and grant complimentary credits.
- S13 — Show creator sales and customer credit history accurately.
