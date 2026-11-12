-- S04: publish immutable plan versions on the creator's own Stripe account.
--
-- A published version now records the exact Product/Price it committed to, so
-- a sellable row can never exist without the offer it sells, and a retry can
-- reuse the objects Stripe already created. `unpublished_at` distinguishes
-- "stopped selling deliberately" from "replaced by a newer version".
--
-- The single-published index makes "one current offer per plan" a database
-- guarantee. Existing rows are already unique per plan because only the S01
-- backfill and sample data ever set `published`; a duplicate here would mean
-- the data was hand-edited, so the index failing is the correct outcome.
ALTER TABLE "plan_versions" ADD COLUMN "unpublished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "stripe_product_id" text;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "stripe_price_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_version_single_published_idx" ON "plan_versions" USING btree ("plan_id") WHERE "plan_versions"."status" = 'published';
