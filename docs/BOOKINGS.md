# Native booking schedules

Status: agreed scope for in-house scheduling. Planning doc; slice-by-slice
implementation follows.

## Why

Bookings used to depend on Cal.com/Calendly webhooks (see the reverted
"spend credits on Cal.com bookings" commit). That put a third party between a
customer's booking and a credit debit, and made the product's core loop depend on
someone else's payload contract. Creators already have a vendor-free way to move
credits (`POST /api/v1/credits/consume`, `consume_credits`), so scheduling is the
only piece we lack.

This document defines a **native** scheduler: creators define availability, link a
schedule to one of their plans, and a booking spends credits through the same
credit service every other debit uses. Google Calendar is an optional integration,
never a requirement.

The Cal.com connection in `app/dashboard/integrations` is left in place. Native
schedules are additive: a creator may use either, and the vendor path is no longer
the only option.

## Non-negotiables

- **Money rules live in one place.** A booking debit goes through
  `adjustCredits` (`lib/services/credits.ts`), so overdraft protection, grant
  allocation, expiry, idempotency, and the ledger are not reimplemented. A
  cancellation restores only the units that booking took, to the same grants.
- **Double-booking is prevented by the database**, not by a read-then-write check.
  A `btree_gist` exclusion constraint on `(creator_id, tstzrange(starts_at,
  ends_at))` makes overlapping confirmed bookings impossible under concurrency.
- **Credits are only spent for a known customer.** `requireScope` intentionally
  allows `credits:consume` only for machine keys, so a customer session must never
  spend arbitrary credits. Booking therefore has its own service that debits *on
  behalf of the authenticated customer*, scoped to the schedule's creator.
- **No cron.** Correctness never depends on a scheduled job. Slot availability,
  expiry, and "starting soon" are computed on read.
- **No email in v1.** Every notification is in-app.
- **Times are UTC instants plus an explicit IANA timezone.** Never store a local
  wall-clock time without its zone.

## Consequences to accept

- **Booking requires sign-in.** Without an email/identity we cannot know whose
  credits to spend. `creditsPerBooking` of `null` still requires sign-in so the
  booking is attributable.
- **Reminders are computed on read.** A "starting in 15 minutes" notification
  appears when the user opens the app, not pushed at a wall-clock moment. That is
  the price of having no scheduler, and it is the right trade for v1.
- **Google Calendar can be absent.** B1–B4 work with no integrations at all.

## Domain model

| Table | Purpose |
| --- | --- |
| `booking_schedules` | Creator-owned bookable offer: slug, duration, buffers, horizon, timezone, optional `plan_id`, `credits_per_booking`, active. |
| `booking_availability` | Weekly windows (weekday + minutes-of-day in the schedule's timezone). |
| `booking_exceptions` | One-off blocked ranges (holidays, travel). |
| `bookings` | A confirmed slot: schedule, creator, customer, UTC start/end, status, charge transaction, restore timestamp. |
| `calendar_connections` | Optional external calendar link; tokens encrypted at rest. |
| `notifications` | In-app notification rows with a dedupe key. |

`bookings.status` is one of `confirmed`, `cancelled`, `completed`, `no_show`.

## Slice breakdown

Each slice owns its schema, service, transport, UI, docs, and behavior checks. Slices
B1–B4 are independent of any external service; B5 is the only one with a vendor.

### B1 — Book a slot and spend credits

**Type:** AFK

**User story:** As a signed-in customer, I can book an available slot on a
creator's schedule and see the credits it spent.

#### What to build

A public `/book/[slug]` page that lists open slots for a schedule and books one.
Booking validates the slot against availability, the schedule's horizon and
buffers, and the customer's enrollment, then debits `creditsPerBooking` through
`adjustCredits`. Cancelling restores exactly what the booking spent.

#### Acceptance criteria

- [ ] Only a signed-in customer may book; an anonymous visitor is prompted to sign
      in and returns to the same schedule.
- [ ] A slot is bookable only if it lies inside a weekly window (in the schedule's
      timezone), is not inside an exception, is not within the past, and is inside
      the booking horizon.
- [ ] Two concurrent bookings for the same slot cannot both succeed; the loser gets
      a clear "slot taken" result, not a partial debit.
- [ ] A booking with `credits_per_booking` set debits exactly that many credits; a
      customer with too few is refused and spends nothing.
- [ ] With `credits_per_booking` null, the booking is recorded but no ledger row is
      written.
- [ ] Cancelling a booking restores only the units that booking took, back to the
      grants they came from. Expired or already re-spent units are never
      resurrected, so a book/cancel loop cannot mint credits.
- [ ] Cancellation is idempotent and cannot be repeated to restore twice.
- [ ] The debit is recorded with the booking as its source, so history relates a
      credit effect to its booking.
- [ ] Another creator's schedule, bookings, or balances are unreachable.

#### Verification / demo

Book the last two credits on a two-credit booking, cancel it, and confirm the
balance returns to exactly two. Race two bookings for one slot and show one
success. Attempt an anonymous booking.

### B2 — Define availability

**Type:** AFK

**User story:** As a creator, I can say when I am bookable without touching a
calendar.

#### What to build

A dashboard editor for a schedule: weekly windows, duration, buffer, horizon,
timezone, and one-off exceptions.

#### Acceptance criteria

- [ ] Weekly windows are stored per weekday in the schedule's timezone and rendered
      unambiguously to the creator.
- [ ] Windows that end before they start, or that overlap each other on the same
      day, are rejected with a clear message.
- [ ] Changing the schedule's timezone does not silently shift already-booked
      bookings; existing bookings keep their UTC instants.
- [ ] Blocking a day removes its slots immediately, including when the block
      overlaps an existing window.
- [ ] DST transitions do not produce slots at nonexistent or duplicated local
      times.
- [ ] Sample/demo mode keeps working and is not mutated by real edits.

### B3 — Link a plan to a schedule

**Type:** AFK

**User story:** As a creator, I can attach a schedule to a plan so a booking spends
that plan's credits, from either the plans screen or the booking screen.

#### What to build

A schedule references one plan. The link is editable from the plan details view
and from the schedule editor, and both surfaces show the same state.

#### Acceptance criteria

- [ ] A schedule may be linked to a draft or published plan; booking fails clearly
      while the plan is not sellable, rather than granting credits for nothing.
- [ ] Unlinking a plan disables new bookings without deleting existing bookings or
      their ledger rows.
- [ ] The plan details view shows the linked schedule and its credit cost.
- [ ] Linking is creator-scoped; a schedule cannot reference another creator's plan.
- [ ] Monthly plans are rejected as booking targets in v1 (a booking is not a
      billing period), with an explanatory message.

### B4 — In-app notifications

**Type:** AFK

**User story:** As a creator or customer, I can see booking activity inside the app.

#### What to build

A `notifications` table plus a bell in `nav-user`. Booking confirmed, booking
cancelled, and "starting soon" appear in-app. No email is sent.

#### Acceptance criteria

- [ ] A confirmed booking notifies both the creator and the customer exactly once.
- [ ] A cancellation notifies the other party exactly once, and the notification
      names what happened to the credits.
- [ ] A dedupe key makes repeated delivery of the same event idempotent.
- [ ] "Starting soon" is computed on read from booking times, so no scheduled job
      is required, and it never appears for a cancelled or past booking.
- [ ] Users can mark notifications read, and only their own are visible.
- [ ] A missing/disabled notification path never blocks a booking or a debit.

### B5 — Google Calendar sync (optional)

**Type:** HITL (requires an operator to register the OAuth client)

**User story:** As a creator, I can connect Google Calendar so busy times block
slots and bookings appear on my calendar.

#### What to build

OAuth connection with tokens encrypted at rest, free/busy reads that subtract
busy intervals from available slots, and event creation/deletion on book/cancel.

#### Acceptance criteria

- [ ] Tokens are encrypted at rest and never returned to the client or written to
      logs.
- [ ] Free/busy failure degrades to "calendar not synced" rather than blocking
      existing bookings; the creator sees a visible, retryable state.
- [ ] A busy interval removes matching slots; a booked slot blocks the same time.
- [ ] Disconnecting stops sync without cancelling bookings or revoking credits.
- [ ] Sync is best-effort: a Google failure never rolls back a booking or a debit.
- [ ] The whole native product (B1–B4) works with B5 absent.

## Also deferred

Team/round-robin scheduling, paid deposits, rescheduling self-service, intake
forms, recurring bookings, and reminders pushed from a scheduler. Yearly offers and
billing changes stay with `docs/SUBSCRIPTIONS.md`.
