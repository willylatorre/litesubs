# Refocus: subscriptions and credits only

Status: agreed direction, being implemented.

Two changes, decided together because they both remove surface area:

1. **Bookings move to Plannerie.** Scheduling was the biggest non-subscription
   feature in Litesubs and it belongs with the teacher's lesson workspace.
   Litesubs stops owning availability, slots, and calendar sync, and keeps only
   what it is good at: a price, a credit grant, and a ledger.
2. **The 1% commission is replaced by a flat $5/month premium tier.** A free
   creator can publish two one-time packs. Premium removes that cap and unlocks
   the recurring and machine-facing features.

## Why bookings leave

The native scheduler is ~6,000 lines across five tables, a slot engine, a
Google Calendar client, and a booking dashboard. It shares almost nothing with
the money path except a call to `adjustCredits`. Keeping it in Litesubs means
maintaining a calendar product inside a billing product, and it pulls the
roadmap toward scheduling instead of subscriptions.

The moved feature is not a thin adapter: there is no public booking API to
re-point. Plannerie builds its own schedule model, and the only surviving
contract is the one that matters financially — **a booking debits credits
through the Litesubs API**, never through a second ledger.

## Booking ↔ credit boundary

| Concern | Owner |
| --- | --- |
| Weekly availability, exceptions, slot generation, double-booking | Plannerie |
| Google Calendar busy/free and event sync | Plannerie |
| Booking lifecycle and notifications | Plannerie |
| Price, packs, published terms | Litesubs |
| Credit grants, debits, refunds, expiry | Litesubs |
| "This booking spent N credits" | Litesubs ledger row, referenced by Plannerie |

Plannerie calls `POST /api/v1/credits/consume` with a stable
`idempotency_key` derived from its booking id, and a compensating grant for a
cancellation. It stores the returned transaction id as its own reference. It
never holds a balance of its own.

## Data

Greenfield: there is no production schedule or booking to preserve. The tables
are dropped, not migrated. Shared `/book/<creator>/<slug>` links redirect to
Plannerie so an already-sent link does not 404.

## Pricing model

| | Free | Premium — $5/month |
| --- | --- | --- |
| Published one-time packs | 2 | Unlimited |
| Monthly / recurring plans | No | Yes |
| API keys, webhooks, MCP | No | Yes |
| Stripe Connect onboarding | Yes | Yes |

Rates: no application fee on either tier. The creator keeps the whole sale
minus Stripe's own processing fee, on their own connected account. This is a
deliberate revenue-model change: the platform is paid for by a subscription,
not by a cut of each sale.

Constraints that keep this honest:

- **The tier is enforced server-side.** A cap that only hides a button is not a
  cap. `createPlan`, `publishPlan`, API-key creation, and webhook creation all
  consult the same entitlement service.
- **Downgrading never deletes data.** Published packs beyond the free cap stay
  live and sellable, and existing monthly subscriptions keep renewing. Only
  **new** plan creation is refused, plus editing a plan *into* a recurring one.
  Taking a live offer away from a creator to enforce a pricing change would be
  removing money from their hands, so it is deliberately not done.
- **The premium subscription is on the platform's Stripe account**, not a
  connected account. It is the one charge in the product that is not a direct
  charge, and its webhook events are distinguished by the absence of
  `event.account`.

## Slices

- **R1 — Remove bookings and calendar.** Delete the scheduler, the Google
  integration, the notifications that existed only for bookings, and the
  tables. Redirect `/book/*`.
- **R2 — Remove the commission.** Stop sending `application_fee_amount` /
  `application_fee_percent`; relax the stored fee constraint; rewrite the
  pricing, terms, privacy, and FAQ copy.
- **R3 — Entitlements.** Add the creator tier, the free pack cap, and premium
  gates on recurring plans and developer features.
- **R4 — Premium billing.** Platform-account checkout, portal, webhook
  handling, and a billing screen. *Revised:* this is now built on
  `@better-auth/stripe` rather than a hand-rolled service. See
  `docs/PLATFORM-BILLING.md`, which replaces the `premium.ts` approach.

## Non-goals

- Per-seat pricing, trials, proration policy, annual terms.
- Migrating booking history (there is none).
- A second money ledger anywhere.
