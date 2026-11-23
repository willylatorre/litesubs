-- Platform billing: record the paid-through boundary the platform subscription
-- row cannot represent.
--
-- `litesub_subscription.period_end` is Stripe's *current* billing period end.
-- Stripe advances it when a renewal period STARTS, before the invoice is paid,
-- and keeps it there when the renewal then fails. Deriving entitlement from it
-- therefore grants a month nobody paid for as soon as a renewal fails — the
-- exact rule `docs/PLATFORM-BILLING.md` promises to keep ("a failed renewal must
-- not revoke a period the creator already paid for") is the mirror case, and it
-- was only half implemented.
--
-- `paid_through_at` is the end of the latest invoice that was actually PAID. It
-- only ever moves forward, so it survives a failed renewal, a retry, and an
-- out-of-order delivery. Entitlement reads this column, not `period_end`.
--
-- Nullable because every existing row predates it: a null means "not known yet,
-- refresh from Stripe" rather than "never paid". The refresh path fills it on
-- the next webhook for that creator.
ALTER TABLE "litesub_subscription" ADD COLUMN IF NOT EXISTS "paid_through_at" timestamp with time zone;--> statement-breakpoint

-- Backfill only where it is provably correct: a row Stripe currently reports as
-- fully paid in an active period has a boundary equal to its period_end. Rows
-- that are `past_due`, `incomplete`, or `canceled` are deliberately left null —
-- their true boundary is an earlier, already-paid period end that lives only in
-- Stripe's invoice history, and guessing `period_end` is the bug this column
-- exists to fix. `refreshPaidThrough` resolves those from invoices.
UPDATE "litesub_subscription"
SET "paid_through_at" = "period_end"
WHERE "paid_through_at" IS NULL
  AND "period_end" IS NOT NULL
  AND "status" = 'active';
