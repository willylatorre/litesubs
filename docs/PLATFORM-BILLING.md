# Platform billing: use `@better-auth/stripe` for Litesubs' own subscription

Status: implemented. Supersedes the hand-rolled `lib/services/premium.ts` from
`docs/REFOCUS.md` slice R4.

> **Decisions taken while building (2026-11-22).**
> - The physical table is **`litesub_subscription`**, exported as `subscription`.
>   The Drizzle adapter resolves the model to the table object and reads the
>   physical name from `pgTable(...)`, so the alias needs no adapter config.
>   Verified by round-tripping a row through `auth.$context.adapter`.
> - **`createCustomerOnSignUp` stays off.** Every buyer is also a user, so it
>   would mint a platform Customer for people who never pay Litesubs. The
>   checkout path creates one lazily — verified: a real test-mode
>   `cs_test_` session carried the $5 price and a freshly created customer.
> - `referenceId` is **unique**: one creator, one platform subscription.
> - The Connect webhook is untouched; platform events go to
>   `/api/auth/stripe/webhook`. A live check found the Connect endpoint
>   subscribed to only 5 of its 11 required events (no `invoice.paid`, no
>   `customer.subscription.*`), so renewals would never have granted credits.
>   That is an operator dashboard fix, recorded in `docs/MCP.md`.

## The distinction this plan is built on

Two billing domains live in this product and they must never be confused. They
share a database and a Stripe account list; they share nothing else.

| | **Platform billing** (Litesubs ↔ creator) | **Connect sales** (creator ↔ their customer) |
| --- | --- | --- |
| What is sold | access to Litesubs features | credits, per creator |
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
  subscription item and fires `onSubscriptionUpdate`. **Unverified: whether
  Stripe emits `customer.subscription.updated` on every renewal.** If it does not,
  the paid-through date goes stale and entitlement silently expires a month
  early. This is the one thing to prove before shipping.

## Target model

```
user.stripe_customer_id          -- re-added; platform Customer id (not per-account)
subscription                     -- NEW plugin model, physical name litesub_subscription
  id, plan, referenceId(=user.id), stripeCustomerId, stripeSubscriptionId,
  status, periodStart, periodEnd, cancelAtPeriodEnd, cancelAt, endedAt,
  seats, billingInterval, ...
subscriptions                    -- UNCHANGED: creator→customer Connect sales
```

### What happens to `creator_entitlements`

It is deleted. It was a hand-rolled mirror of `subscription`, and keeping both
guarantees drift. Entitlement becomes a **derivation**:

```
tier = plan === 'premium' && status ∈ {active, trialing, past_due}
       && periodEnd > now
         ? 'premium' : 'free'
```

`paidThroughAt` becomes `subscription.periodEnd`. That preserves the rule the
current code already implements — a failed renewal must not revoke a period the
creator already paid for — and it was the reason `creator_entitlements` existed.
`past_due` keeps access because Stripe is still retrying a period it owes.

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

- Migration test for `0021` (money rows survive; `subscription` shape correct).
- Entitlement derivation unit tests: active → premium; `past_due` with future
  `periodEnd` → premium; `canceled` with future `periodEnd` → premium; missing
  row → free; expired `periodEnd` → free.
- Replace `grantTestPremium` fixtures; re-run the full integration suite with the
  new premium fixture.

## Open questions — decide before step 4

1. **Renewal freshness.** Confirm `customer.subscription.updated` fires per
   renewal with a new `periodEnd`. If it does not, add an `invoice.payment_succeeded`
   handler via `onEvent` that extends `periodEnd` — the Plannerie pattern. This
   decides whether entitlement expiry is correct, so it gates shipping.
2. **`plan` name.** One plan, `premium`. Confirm no free-trial window and no
   annual option for v1 (both are plugin features we would be buying into).
3. **Downgrade path.** The plugin's `/cancel` sets cancel-at-period-end. Confirm
   we never call it automatically when a creator hits the plan cap — a creator
   over the free cap keeps their existing plans (already the rule in
   `docs/REFOCUS.md`), so nothing should force a downgrade.
4. **Test-mode.** Is a Stripe test-mode Price acceptable for the first
   verification, or does the operator want live verification deferred as in R4?

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
- `periodEnd` cannot be kept current from available events. Entitlement would
  then expire wrongly; stop and use the invoice path before wiring the UI.
