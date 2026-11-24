-- Record when the paid-through boundary was last resolved from Stripe.
--
-- `paid_through_at` is null in two very different situations:
--
--   1. we have not looked yet (a row written before 0022, or a brand new one);
--   2. we looked and found no paid invoice (an abandoned checkout, or a
--      subscription that has never successfully charged).
--
-- Without distinguishing them, the lazy refresh in `getEntitlement` cannot tell
-- whether a null means "retry me" or "there is nothing to find". It retried on
-- every dashboard load for case 2, calling Stripe forever and never succeeding.
--
-- `paid_through_checked_at` is the timestamp of the last attempt, whatever it
-- found. A null boundary with a recent check timestamp is "known unpaid"; a null
-- boundary with an old or missing timestamp is "worth checking".
ALTER TABLE "litesub_subscription" ADD COLUMN IF NOT EXISTS "paid_through_checked_at" timestamp with time zone;--> statement-breakpoint

-- Existing rows have never been checked by this code. Leave both columns null:
-- `paid_through_at` where 0022 could prove it (active rows) is already trustworth,
-- and the rest are exactly the rows that need one resolving look.
