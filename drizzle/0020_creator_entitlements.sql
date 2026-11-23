-- Creator tiers: free (default) and premium ($5/month).
--
-- The commission is gone (`0019`), so the platform is paid for by a creator
-- subscription instead of a cut of each sale. See `docs/REFOCUS.md`.
--
-- This table is the *billing relationship*, not a feature flag. `tier` is
-- derived from `paidThroughAt` by `lib/services/entitlements.ts`, so a failed
-- renewal cannot revoke access the creator already paid for, and a canceled
-- subscription keeps working until its paid period actually ends.
--
-- No rows are created here. A creator with no row is `free`, which is the
-- correct default and needs no backfill.
CREATE TYPE "public"."creator_tier" AS ENUM('free', 'premium');--> statement-breakpoint
CREATE TYPE "public"."creator_subscription_status" AS ENUM('active', 'past_due', 'canceled', 'incomplete');--> statement-breakpoint
CREATE TABLE "creator_entitlements" (
	"creator_id" text PRIMARY KEY NOT NULL,
	"tier" "creator_tier" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" "creator_subscription_status",
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"paid_through_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_entitlements_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "creator_entitlements_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "creator_entitlements" ADD CONSTRAINT "creator_entitlements_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_entitlement_tier_idx" ON "creator_entitlements" USING btree ("tier");
