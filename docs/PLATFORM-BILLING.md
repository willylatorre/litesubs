# Platform billing: use `@better-auth/stripe` for liteSubs' own subscription

Status: implemented. Supersedes the hand-rolled `lib/services/premium.ts` from
`docs/REFOCUS.md` slice R4.

> **Decisions taken while building (2026-11-22).**
> - The physical table is **`litesub_subscription`**, exported as `subscription`.
>   The Drizzle adapter resolves the model to the table object and reads the
>   physical name from `pgTable(...)`, so the alias needs no adapter config.
>   Verified by round-tripping a row through `auth.$context.adapter`.
> - **`createCustomerOnSignUp` stays off.** Every buyer is also a user, so it
>   would mint a platform Customer for people who never pay liteSubs. The
>   checkout path creates one lazily — verified: a real test-mode
>   `cs_test_` session carried the $5 price and a freshly created customer.
> - `referenceId` is **unique**: one creator, one platform subscription.
> - The Connect webhook is untouched; platform events go to
>   `/api/auth/stripe/webhook`. A live check found the Connect endpoint
>   subscribed to only 5 of its 11 required events (no `invoice.paid`, no
>   `customer.subscription.*`), so renewals would never have granted credits.
>   That is an operator dashboard fix, recorded in `docs/MCP.md`.
> - **Entitlement reads `paid_through_at`, not `period_end`.** Measured on
>   2026-11-23: Stripe advances `period_end` when a renewal *starts* and leaves it
>   advanced when the payment fails, so `period_end` grants unpaid months. A new
>   column records the last period actually paid for. See "Measured renewal
>   behaviour".

## The distinction this plan is built on

Two billing domains live in this product and they must never be confused. They
share a database and a Stripe account list; they share nothing else.

| | **Platform billing** (liteSubs ↔ creator) | **Connect sales** (creator ↔ their customer) |
| --- | --- | --- |
| What is sold | access to liteSubs features | credits, per creator |
| Who pays | the creator | the creator's customer |
| Stripe account | **the platform's** | the creator's **connected** account |
| Evidence in a webhook | `event.account` **absent** | `event.account` **present** |
| Existing table | `creator_entitlements` (hand-rolled) | `subscriptions` |
| Price source | `STRIPE_PREMIUM_PRICE_ID` ($5/mo) | `plan_versions` on the connected account |

`lib/services/entitlements.ts` and `premium.ts` reference
`subscriptions`/`connectedAccounts`/`creatorCustomers` **zero times**. One column,
`creator_id ↔ user.id`, joins the domains, and that is the whole relationship.

Because they are separate domains, **two webhook endpoints is the correct
mapping, not duplication.** `/api/webhooks/stripe` stays the Connect endpoint;
the plugin installs `/api/auth/stripe/webhook` for platform billing.

## Why the plugin, and what it costs

The plugin is a platform-billed SaaS subscription manager, which is exactly what
platform billing is. It provides `/subscription/upgrade`, `/billing-portal`,
`/cancel`, `/restore`, `/list`, `/success` — most of what `premium.ts` hand-wrote.

Verified against the installed `@better-auth/stripe@1.7.18`:

- Model key is **`subscription`**, 34 hardcoded `model: "subscription"` calls.
  Fields: `plan`, `referenceId`, `stripeCustomerId`, `stripeSubscriptionId`,
  `status`, `periodStart`, `periodEnd`, `trialStart`, `trialEnd`,
  `cancelAtPeriodEnd`, `cancelAt`, `canceledAt`, `endedAt`, `seats`,
  `billingInterval`, `stripeScheduleId`. It also declares
  `user.stripeCustomerId`.
- `referenceId` defaults to `user.id`; passing a *different* one requires
  `authorizeReference`. We will not pass one — the session user is the reference,
  which is also the secure default.
- `createCustomerOnSignUp` is **off by default**; the upgrade path creates the
  Customer lazily when one is missing. We keep it off.
- Its schema is merged with ours via `mergeSchema`, so adding the table is
  additive.

What it does **not** do, and must not be assumed:

- `onSubscriptionComplete` fires **only** from `checkout.session.completed`.
  Plannerie's T011 hit this: renewals granted nothing. We do not rely on that
  hook at all.
- `onSubscriptionUpdated` writes `periodStart`/`periodEnd` from the Stripe
  subscription item and fires `onSubscriptionUpdate`. **Verified 2026-11-23:** it
  does fire on every renewal with a fresh `period_end` (see "Measured renewal
  behaviour" below). That removes the original "a month early" fear — but it
  exposed a different bug: `period_end` advances *before* payment, so it cannot
  be the entitlement signal. See the next section.

## Measured renewal behaviour (2026-11-23)

Everything below was measured against real Stripe **test mode** using a test
clock, not inferred from the plugin's source. Two subscriptions were advanced
through paid renewals, a failed renewal, and cancellation.

**1. `customer.subscription.updated` does fire per renewal.** On each renewal it
arrives with the *next* period's end:

| Event | When | `item.current_period_end` |
| --- | --- | --- |
| `customer.subscription.created` | after first payment | 2026-12-23 |
| `customer.subscription.updated` | at renewal start | 2027-01-23 |
| `invoice.paid` (`subscription_cycle`) | seconds later | — |

So `periodEnd` stays current. **The original open question is answered: yes.**

**2. But `updated` arrives *before* the invoice is paid — and a failed renewal
keeps the advanced `period_end`.** This is the important finding. On a renewal
whose payment failed:

```
status:      past_due
period_start: 2026-12-23   <- the renewal period that was NOT paid
period_end:   2027-01-23   <- a month the creator never paid for
last invoice paid through: 2026-12-23
```

`period_end` therefore does **not** answer "what has this creator paid for". A
rule reading it grants a free month to anyone whose card stops working. That is
what `deriveEntitlement` did before this change.

**3. Dunning eventually deletes the subscription but leaves `period_end`
advanced.** After retries were exhausted the subscription became `canceled` with
`ended_at` set and `period_end` still pointing at the unpaid month. Dunning runs
over days, so this is not a corner case — it is what most failed renewals end in.

**The fix.** `litesub_subscription.paid_through_at` (migration `0022`) records
the end of the latest invoice that was actually **paid**, resolved from Stripe's
invoice history. `entitlements.ts` reads that column. It is monotonic (forward
only), so a failed renewal, a retry, or an out-of-order delivery cannot revoke a
period that was paid for. A `null` boundary means "unknown", never "paid
forever"; the next platform webhook (or the first `getEntitlement` after the
column was added) refreshes it from invoices.

Two constraints keep that refresh cheap, because it is on a read path:

- **One bounded request.** `for await` over `invoices.list()` auto-paginates the
  *entire* history (`limit` is a page size, not a total cap), so a creator with
  years of invoices made every refresh walk all of them. `resolvePaidThrough`
  reads one page of 100 and stops — far more months than an entitlement needs.
- **No repeat on every page load.** `paid_through_checked_at` (migration `0023`)
  records that a look happened even when it found nothing. An abandoned checkout
  has no paid invoice, so without it every dashboard load re-queried Stripe,
  forever, and re-learned nothing. A null boundary is now retried at most once
  per 6 hours, and the webhook remains the primary repair path.

Proven end to end by `scripts/verify-platform-billing.mts`, which creates real
Stripe objects on a test clock and feeds the **real emitted events** through the
**real** `/api/auth/stripe/webhook` route, signed with that endpoint's secret.
13/13 checks pass: paid creation → premium, renewal → `periodEnd` extended, failed
renewal → the unpaid month refused while the paid month is kept, deleted →
downgrade only after the period. The same harness fails check 3d if the old
`periodEnd` rule is restored, so it is not a test that passes against broken code.

## Target model

```
user.stripe_customer_id          -- re-added; platform Customer id (not per-account)
subscription                     -- NEW plugin model, physical name litesub_subscription
  id, plan, referenceId(=user.id), stripeCustomerId, stripeSubscriptionId,
  status, periodStart, periodEnd, paidThroughAt, cancelAtPeriodEnd, cancelAt,
  endedAt, seats, billingInterval, ...
subscriptions                    -- UNCHANGED: creator→customer Connect sales
```

`periodEnd` is Stripe's current period; `paidThroughAt` (migration `0022`) is the
last period actually paid for, and is the only column entitlement trusts.

### What happens to `creator_entitlements`

It is deleted. It was a hand-rolled mirror of `subscription`, and keeping both
guarantees drift. Entitlement becomes a **derivation**:

```
tier = plan === 'premium' && status ∉ {incomplete, incomplete_expired}
       && paidThroughAt > now            -- the last period actually PAID for
         ? 'premium' : 'free'
```

`paidThroughAt` is **not** `subscription.periodEnd`. Stripe advances
`period_end` when a renewal period starts, before the invoice is paid, and leaves
it advanced when that payment fails — measured, see "Measured renewal behaviour".
`paid_through_at` only moves on a paid invoice. That preserves the rule the
current code already implements — a failed renewal must not revoke a period the
creator already paid for — and it also refuses the period they have not paid for,
which reading `period_end` could not do.

`past_due` keeps access because Stripe is still retrying a period it owes *only
up to the paid boundary*; it does not extend it.

`lib/services/entitlements.ts` keeps its public shape (`getEntitlement`,
`assertCanCreatePlan`, `assertCanUseRecurring`, `assertCanUseDeveloperFeatures`,
`FREE_PLAN_LIMIT`) so every call site is untouched. Only its query changes.

## Environment

| Variable | Purpose |
| --- | --- |
| `STRIPE_PREMIUM_PRICE_ID` | the $5/mo Price (already planned in R4) |
| `STRIPE_WEBHOOK_BILLING` | **new** signing secret for `/api/auth/stripe/webhook` |
| `STRIPE_WEBHOOK_SECRET` | unchanged — Connect endpoint only |

They must be **different secrets**: Stripe signs per endpoint, so one secret
cannot verify both. The unused `STRIPE_WEBHOOK_PURCHASES` is repurposed or
removed (it is already documented as unused).

Dashboard prerequisite (operator, not agent): create a second endpoint at
`https://litesubs.com/api/auth/stripe/webhook` subscribed to
`checkout.session.completed`, `customer.subscription.*`,
`invoice.payment_succeeded`, `invoice.payment_failed`. Do **not** add these to
the Connect endpoint — platform events arriving there would fail the
`event.account` check by design, and that failure is correct.

## Ordered work

Each step is separately verifiable.

### 1. Schema and migration (`0021_platform_billing.sql`)

- Add `user.stripe_customer_id text unique`.
- Create `subscription` with the plugin's exact field set, plus `createdAt`/
  `updatedAt`. `plan` and `referenceId` not null; the rest nullable where the
  plugin declares them optional.
- Drop `creator_entitlements` and the `creator_tier` /
  `creator_subscription_status` enums.
- Export the table as `subscription` (singular) from `app/db/schema.ts` so the
  Drizzle adapter's `fullSchema` resolves the model name. `usePlural` stays off.

Verification: replay all migrations on a disposable DB; assert `subscription`
exists, `subscriptions` still holds every Connect row, and dropping
`creator_entitlements` takes no other table with it.

### 2. Plugin wiring (`lib/auth.ts`)

- Add `stripe({ stripeClient, stripeWebhookSecret, subscription: { enabled: true,
  plans: [{ name: 'premium', priceId }] }, createCustomerOnSignUp: false })`.
- `plans` is built from env; if `STRIPE_PREMIUM_PRICE_ID` is absent, **omit the
  plugin entirely** (as Plannerie does) rather than registering a plan with no
  price, which would throw at checkout with a less clear error.
- Keep `nextCookies()` last.
- Update the stale comment that says "No Stripe customer plugin" — it was true
  when there was no platform customer and is now false for this domain.

### 3. Entitlement derivation (`lib/services/entitlements.ts`)

- Read `subscription` where `referenceId = creatorId`, pick the active row.
- Derive tier from plan + status + `periodEnd`. Keep `planCount` from `plans`.
- Delete `grantTestPremium`'s dependency on `creator_entitlements`; insert a
  `subscription` row instead.

### 4. Billing surface

- `/dashboard/billing` actions call `auth.api.upgradeSubscription` /
  `createBillingPortal` instead of `premium.ts`.
- Delete `lib/services/premium.ts` and `app/actions/billing.ts`, or reduce them
  to thin wrappers over `auth.api.*` that bind the session and map errors.
- Keep the page's copy; only the transport changes.

### 5. Tests

- Migration test for `0021` (money rows survive; `subscription` shape correct)
  and `0022` (the paid-through backfill only trusts fully paid rows).
- Entitlement derivation unit tests in `lib/entitlements.test.ts`: active → premium;
  `past_due` whose `paidThroughAt` is in the future → premium; `canceled` with a
  future `paidThroughAt` → premium; missing row → free; expired → free; and the
  failed-renewal trap — `periodEnd` in the future but `paidThroughAt` in the past
  → free.
- `lib/platform-billing.integration.test.ts` exercises the same rules through
  real services and a real database.
- Replace `grantTestPremium` fixtures; re-run the full integration suite with the
  new premium fixture.

## Open questions — decided

1. **Renewal freshness.** **Answered 2026-11-23: yes.** `customer.subscription.updated`
   fires on every renewal with a fresh `period_end` (measured twice on a test
   clock). The original expiry fear was unfounded, but the measurement exposed a
   worse bug — `period_end` advances before payment — which is why entitlement
   reads `paidThroughAt` instead. See "Measured renewal behaviour".
2. **`plan` name.** One plan, `premium`. No free trial and no annual option for
   v1.
3. **Downgrade path.** The plugin's `/cancel` sets cancel-at-period-end. We never
   call it automatically when a creator hits the plan cap — a creator over the
   free cap keeps their existing plans (the rule in `docs/REFOCUS.md`), so nothing
   forces a downgrade.
4. **Test-mode.** Test-mode was sufficient to prove the logic end to end. A live
   payment remains an operator step because it spends real money.

## Non-goals

- Migrating creators who paid the old 1% commission — there are none to migrate.
- Annual pricing, trials, proration policy, multiple tiers, per-seat billing.
- Any change to the Connect charge path (`subscriptions`, `payments`,
  `credit_*`), which is a different domain and stays exactly as it is.

## STOP conditions

- The plugin would need to write into `subscriptions` or read
  `connectedAccounts`. That is a domain leak; stop and reconsider rather than
  map it.
- A single webhook secret would have to serve both endpoints. It cannot; stop
  and get the second secret configured.
- Entitlement is derived from `periodEnd` rather than `paidThroughAt`. Stripe
  advances `periodEnd` before payment, so that rule grants unpaid periods; stop
  and resolve the paid boundary from invoices instead.

## Operator checklist (not agent-doable)

Recording these because the code is ready and the dashboard is not. Each item was
verified as *missing* on 2026-11-22 unless noted.

**Stripe — test mode**

1. Create the $5/month Price on the platform account. Done on 2026-11-22:
   `price_1UecmNDBzN1ABLUPcZMD2sch` (product `prod_VfyjFTB1R7uZWS`, lookup key
   `litesubs_premium_monthly_usd`). Repeat for live with `--allow-live`-style
   deliberation; a live Price is a new id and a new env value.
2. Add a **platform** webhook endpoint at
   `https://litesubs.com/api/auth/stripe/webhook`, subscribed to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.paid`, `invoice.payment_failed`. Copy its signing secret into
   `STRIPE_WEBHOOK_BILLING`. It is a *different* secret from the Connect one.
3. **Fix the Connect endpoint.** `https://litesubs.com/api/webhooks/stripe` is
   subscribed to only five events. It is missing `invoice.paid`,
   `invoice.payment_failed`, `invoice.payment_action_required`,
   `customer.subscription.updated`, `customer.subscription.deleted`, and
   `checkout.session.async_payment_succeeded`. Without the invoice and
   subscription events, **monthly renewals never grant credits** and a delayed
   payment method is paid for and never fulfilled. This is a live correctness
   bug, not a nicety.

**Environment**

4. Set `STRIPE_PREMIUM_PRICE_ID` and `STRIPE_WEBHOOK_BILLING`. Both are required
   together: with either missing the plugin is not registered and checkout is not
   offered, which is the intended degrade rather than a half-configured plan.

**What is now proven (no operator action needed)**

5. ~~A real payment through the platform endpoint.~~ **Proven 2026-11-23** against
   real test-mode Stripe through the real webhook route: a paid creation grants
   premium, and a renewal extends the paid period. Reproduce with
   `scripts/verify-platform-billing.mts` (it creates its own test clock, customer,
   and subscription, so it needs no browser and spends no real money).
6. ~~Does `customer.subscription.updated` fire on every renewal?~~ **Proven: yes.**
   Measured twice on a test clock. The open question is closed; the design was
   nevertheless changed, because the measurement showed `period_end` advancing
   before payment. Entitlement now reads `paid_through_at`.

**Still owed — a real live payment**

7. The `$5` live Price (item 1) and a live payment through the platform endpoint.
   Test mode cannot prove a real card, a real webhook delivery over the public
   internet, or the live signing secret. Everything about the *logic* is proven;
   what remains is the live configuration and one real charge.
8. Run `scripts/verify-platform-billing.mts` against a disposable database after
   any change to the webhook path. It is the only place the emitted-event ordering
   is exercised; the unit and integration tests assert the rules, not Stripe's
   behaviour.

**Card data never reaches this server (PCI scope)**

9. Both charge paths use Stripe **hosted Checkout**: the server creates a Checkout
   Session and returns its `url`; the card is entered on Stripe's page. There is
   no Stripe.js/Elements bundle, no `paymentIntents.create` with
   `payment_method_data`, and no card field anywhere in this repository. This is
   what keeps the integration out of PCI-DSS scope for card data.

   The one recorded exception was **not product code**: a test-mode probe that
   tried a raw card number to force a declined renewal. Stripe refused it (HTTP
   402, `request id req_aljqsVs1yeZ6gL`) and emailed a first-time warning. The
   probe was rewritten to detach the payment method instead, which produces the
   same `past_due` state without touching card data. If a future probe needs a
   declining card, use a Stripe test **token** (`tok_…`) or a PaymentMethod
   already created through Stripe's own tools — never a PAN. Do not "allow raw
   card data" in the Stripe integration settings to make such a probe work.

**Known gap after this change**

10. An existing creator whose `paid_through_at` is `null` reads as **free** until
   the next platform webhook for that creator, or their first dashboard load
   (`getEntitlement` refreshes lazily from Stripe invoices). This is deliberate —
   guessing `period_end` is the bug being fixed — but an operator deploying this
   should expect a one-time "premium creator appears free" window for anyone whose
   next renewal is more than a moment away. Run
   `creatorsWithUnresolvedPaidThrough()` (in `lib/services/platform-billing.ts`)
   to find them, or simply let the next renewal fix each one. There were no real
   paying creators at the time of this change, so the window is empty today.
