# Refocus: subscriptions and credits only

Status: **R1–R3 implemented; R4 implemented as `@better-auth/stripe`.** The
remaining work is operator configuration in Stripe, plus I3 in Plannerie
(`docs/INTEGRATION.md`). Nothing in this document is unbuilt.

Two changes, decided together because they both remove surface area:

1. **Bookings move to Plannerie.** Scheduling was the biggest non-subscription
   feature in liteSubs and it belongs with the teacher's lesson workspace.
   liteSubs stops owning availability, slots, and calendar sync, and keeps only
   what it is good at: a price, a credit grant, and a ledger.
2. **The 1% commission is replaced by a flat $5/month premium tier.** A free
   creator can publish two one-time packs. Premium removes that cap and unlocks
   the recurring and machine-facing features.

## Why bookings leave

The native scheduler is ~6,000 lines across five tables, a slot engine, a
Google Calendar client, and a booking dashboard. It shares almost nothing with
the money path except a call to `adjustCredits`. Keeping it in liteSubs means
maintaining a calendar product inside a billing product, and it pulls the
roadmap toward scheduling instead of subscriptions.

The moved feature is not a thin adapter: there is no public booking API to
re-point. Plannerie builds its own schedule model, and the only surviving
contract is the one that matters financially — **a booking debits credits
through the liteSubs API**, never through a second ledger.

## Booking ↔ credit boundary

| Concern | Owner |
| --- | --- |
| Weekly availability, exceptions, slot generation, double-booking | Plannerie |
| Google Calendar busy/free and event sync | Plannerie |
| Booking lifecycle and notifications | Plannerie |
| Price, packs, published terms | liteSubs |
| Credit grants, debits, refunds, expiry | liteSubs |
| "This booking spent N credits" | liteSubs ledger row, referenced by Plannerie |

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
| API keys and webhooks | No | Yes |
| MCP (the assistant transport) | Yes | Yes |
| Stripe Connect onboarding | Yes | Yes |

Rates: no application fee on either tier. The creator keeps the whole sale
minus Stripe's own processing fee, on their own connected account. This is a
deliberate revenue-model change: the platform is paid for by a subscription,
not by a cut of each sale.

MCP is on both tiers on purpose. It is a transport over the same services the
dashboard calls, so every capability behind it is gated exactly once, by the
tier. Gating the transport instead would sell *access to an interface* rather
than access to a feature, and a free creator could already do the same things in
the browser. What Premium adds is the machine-facing capability itself:
`credits:consume` requires an API key, and webhooks are a paid feature.

Constraints that keep this honest:

- **The tier is enforced server-side.** A cap that only hides a button is not a
  cap. `createPlan` and plan editing consult the entitlement service before the
  insert, which is where the plan cap and the recurring switch are decided; API-key
  creation and webhook creation consult the same service. `publishPlan`
  deliberately does **not**, and that is the downgrade rule below: a creator who
  already holds a draft may still publish it after their tier lapses, because the
  cap governs how many plans you may *create*, not whether money already on offer
  may be taken. MCP is also not in that list, because it is a transport rather
  than a capability: it calls these same services, so it is gated by them instead
  of beside them.
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

- **R1 — Remove bookings and calendar.** **Done** (`0018`). Scheduler, Google
  integration, booking-only notifications and their tables deleted; `/book/*`
  redirects to PLANNERIE_URL.
- **R2 — Remove the commission.** **Done** (`0019`). No fee is attached to
  either checkout path; the `> 0` constraint is relaxed; pricing, terms,
  privacy, FAQ and the landing diagram rewritten.
- **R3 — Entitlements.** **Done** (`0020`, `0021`). Tier derived from the
  platform subscription; free cap of two plans; Premium gates on recurring
  plans and developer features, enforced in services *and* in front of
  `/api-key/create` and `integrationkeys`.
- **R4 — Premium billing.** **Done on `@better-auth/stripe`** instead of a
  hand-rolled service; `creator_entitlements` was dropped so entitlement has one
  source. See `docs/PLATFORM-BILLING.md`. **Verified end to end 2026-11-23**
  against real test-mode Stripe through the real webhook route; the same run
  found and fixed a defect where a failed renewal granted a month nobody paid for
  (`0022`, `paid_through_at`). Remaining: live Stripe configuration (endpoint,
  secret, live price) and one real live charge — listed as the operator
  checklist.

## Related

- `docs/PLATFORM-BILLING.md` — the creator's own $5/mo tier.
- `docs/INTEGRATION.md` — how any platform (Plannerie first) drives liteSubs:
  the enable flow, credential split, and customer provisioning.

## Non-goals

- Per-seat pricing, trials, proration policy, annual terms.
- Migrating booking history (there is none).
- A second money ledger anywhere.
