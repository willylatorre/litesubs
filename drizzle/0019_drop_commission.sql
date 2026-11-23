-- Remove the 1% commission.
--
-- Litesubs is now paid for by a creator subscription (`docs/REFOCUS.md`), not by
-- a cut of each sale. New charges send no `application_fee_amount` and no
-- `application_fee_percent`, so the creator keeps the whole sale.
--
-- Historical rows are not rewritten. A receipt already charged under the old
-- rate keeps the fee it actually paid, and the reporting query still derives
-- platform fees from the stored rate. Zeroing existing rows would erase money
-- that genuinely left the creator's account.
--
-- The existing check constraint demanded `> 0`, which makes `0` — the new
-- correct value — impossible to store. It is replaced with the same upper bound
-- and a non-negative floor.

-- New subscriptions default to no fee.
ALTER TABLE "subscriptions" ALTER COLUMN "application_fee_percent" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscription_fee_percent_positive";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_fee_percent_bounded"
	CHECK ("application_fee_percent" >= 0 and "application_fee_percent" < 100);--> statement-breakpoint

-- A new receipt's fee is always zero. Existing receipts keep their recorded
-- amount; only the default changes, so `payments` needs no backfill either.
ALTER TABLE "payments" ALTER COLUMN "application_fee" SET DEFAULT 0;
