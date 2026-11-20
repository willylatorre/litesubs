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

Cal.com and Calendly have been removed. Native schedules are the only booking
path; Google Calendar remains an optional busy/free and event-sync integration.

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
  credits to spend, so the booking service refuses an anonymous caller with
  `SIGN_IN_REQUIRED`. Credits are never taken from a shared or inferred account.
- **There are no free bookings.** A bookable schedule always has a plan and a
  positive `creditsPerBooking`; linking a plan without a price is refused with
  `PRICE_REQUIRED`, because a schedule that silently charged nothing would sell
  the creator's time for free. A `null` price means the schedule is unlinked, so
  it is not bookable at all.
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
| `calendar_connections` | Optional external calendar link: tokens encrypted at rest, plus **two** calendar roles (`busy_calendar_id`, `write_calendar_id`). |
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

A public `/book/[username]/[slug]` page lists open slots for a schedule and books
one. The username is the creator's permanent Better Auth username; slugs are only
unique per creator, so the creator segment is required. Booking validates the
slot against availability, the schedule's horizon and buffers, and the customer's
enrollment, then debits `creditsPerBooking` through `adjustCredits`. Cancelling
restores exactly what the booking spent. Legacy twelve-character account links
still resolve and redirect to the username URL once the creator has chosen one.
That length is reserved for legacy handles, so new usernames cannot be ambiguous
with an old link.

#### Acceptance criteria

- [x] Only a signed-in customer may book; an anonymous visitor is prompted to sign
      in and returns to the same schedule.
- [x] A slot is bookable only if it lies inside a weekly window (in the schedule's
      timezone), is not inside an exception, is not within the past, and is inside
      the booking horizon.
- [x] Two concurrent bookings for the same slot cannot both succeed; the loser gets
      a clear "slot taken" result, not a partial debit.
- [x] A booking with `credits_per_booking` set debits exactly that many credits; a
      customer with too few is refused and spends nothing.
- [x] With `credits_per_booking` null the schedule is unlinked and not bookable:
      the service refuses it with `NOT_BOOKABLE` rather than recording a booking
      that spends nothing. Linking a plan requires a positive price, and a
      schedule with no plan is refused the same way.
- [x] Cancelling a booking restores only the units that booking took, back to the
      grants they came from. Expired or already re-spent units are never
      resurrected, so a book/cancel loop cannot mint credits.
- [x] Cancellation is idempotent and cannot be repeated to restore twice.
- [x] The debit is recorded with the booking as its source, so history relates a
      credit effect to its booking.
- [x] Another creator's schedule, bookings, or balances are unreachable.

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

- [x] Weekly windows are stored per weekday in the schedule's timezone and rendered
      unambiguously to the creator.
- [x] Windows that end before they start, or that overlap each other on the same
      day, are rejected with a clear message.
- [x] Changing the schedule's timezone does not silently shift already-booked
      bookings; existing bookings keep their UTC instants.
- [x] Blocking a day removes its slots immediately, including when the block
      overlaps an existing window.
- [x] DST transitions do not produce slots at nonexistent or duplicated local
      times.
- [x] Sample/demo mode keeps working and is not mutated by real edits.

### B3 — Link a plan to a schedule

**Type:** AFK

**User story:** As a creator, I can attach a schedule to a plan so a booking spends
that plan's credits, from either the plans screen or the booking screen.

#### What to build

A schedule references one plan. The link is editable from the plan details view
and from the schedule editor, and both surfaces show the same state.

#### Acceptance criteria

- [x] A schedule may be linked to a draft or published plan; booking fails clearly
      while the plan is not sellable, rather than granting credits for nothing.
- [x] Unlinking a plan disables new bookings without deleting existing bookings or
      their ledger rows.
- [x] The plan details view shows the linked schedule and its credit cost.
- [x] Linking is creator-scoped; a schedule cannot reference another creator's plan.
- [x] Monthly plans are rejected as booking targets in v1 (a booking is not a
      billing period), with an explanatory message.

### B4 — In-app notifications

**Type:** AFK

**User story:** As a creator or customer, I can see booking activity inside the app.

#### What to build

A `notifications` table plus a bell in `nav-user`. Booking confirmed, booking
cancelled, and "starting soon" appear in-app. No email is sent.

#### Acceptance criteria

- [x] A confirmed booking notifies both the creator and the customer exactly once.
- [x] A cancellation notifies the other party exactly once, and the notification
      names what happened to the credits.
- [x] A dedupe key makes repeated delivery of the same event idempotent.
- [x] "Starting soon" is computed on read from booking times, so no scheduled job
      is required, and it never appears for a cancelled or past booking.
- [x] Users can mark notifications read, and only their own are visible.
- [x] A missing/disabled notification path never blocks a booking or a debit.

### B5 — Google Calendar sync (optional)

**Type:** HITL (requires an operator to register the OAuth client)

**User story:** As a creator, I can connect Google Calendar so busy times block
slots and bookings appear on my calendar.

#### What to build

OAuth connection with tokens encrypted at rest, free/busy reads that subtract
busy intervals from available slots, and event creation/deletion on book/cancel.

#### Acceptance criteria

- [x] Tokens are encrypted at rest and never returned to the client or written to
      logs.
- [x] Free/busy failure degrades to "calendar not synced" rather than blocking
      existing bookings; the creator sees a visible, retryable state.
- [x] A busy interval removes matching slots; a booked slot blocks the same time.
- [x] The calendar that **blocks** slots and the calendar that **receives** bookings
      are configured separately. A creator can keep their personal calendar as the
      busy source while bookings land in a dedicated calendar, which can be one
      they already own or one Litesubs creates for them.
- [x] Disconnecting stops sync without cancelling bookings or revoking credits.
- [x] Sync is best-effort: a Google failure never rolls back a booking or a debit.
- [x] The created event id is persisted on the booking, so cancelling removes the
      event instead of leaving an orphan on the creator's calendar.
- [x] The whole native product (B1–B4) works with B5 absent.

**Implementation:** the Google helpers are wired into the booking service:
`listOpenSlots` subtracts busy intervals (best-effort, native slots survive a
Google failure), `createBooking` re-checks the chosen slot against the calendar
before committing, and the created event id is stored on the booking so
`cancelBooking` can delete it. A local stub-fetch run confirmed free/busy is
queried on the busy calendar only while event create/delete hit the write
calendar only. Live verification against Google is still outstanding.

## Also deferred

Team/round-robin scheduling, paid deposits, rescheduling self-service, intake
forms, recurring bookings, and reminders pushed from a scheduler. Yearly offers and
billing changes stay with `docs/SUBSCRIPTIONS.md`.
