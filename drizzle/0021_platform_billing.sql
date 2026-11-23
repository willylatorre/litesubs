-- Platform billing moves to `@better-auth/stripe`.
--
-- Two billing domains, two tables, and they must never be confused:
--
--   litesub_subscription  creator pays Litesubs ($5/mo) — platform Stripe account
--   subscriptions         a creator's customer pays the creator — connected account
--
-- The physical name carries the `litesub_` prefix so a psql prompt or a Stripe
-- log makes the domain obvious. The TypeScript export is `subscription` because
-- `@better-auth/stripe` resolves its model by that key; the Drizzle adapter maps
-- the export to the table object and reads the physical name from `pgTable(...)`,
-- so the alias needs no adapter configuration.
--
-- `creator_entitlements` is dropped rather than kept alongside: it was a
-- hand-rolled mirror of this subscription, and two sources for "is this creator
-- premium" is how entitlement silently drifts from what Stripe actually billed.
-- Entitlement is now derived from the plugin's own row.
--
-- Columns match the plugin's declared schema exactly. Where the plugin marks a
-- field optional, the column is nullable; where it defaults, the column defaults.
CREATE TABLE "litesub_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false,
	"cancel_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"seats" integer,
	"billing_interval" text,
	"stripe_schedule_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone,
	CONSTRAINT "litesub_subscription_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "litesub_subscription_reference_id_unique" UNIQUE("reference_id")
);
--> statement-breakpoint
ALTER TABLE "litesub_subscription" ADD CONSTRAINT "litesub_subscription_reference_id_user_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "litesub_subscription_reference_idx" ON "litesub_subscription" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "litesub_subscription_customer_idx" ON "litesub_subscription" USING btree ("stripe_customer_id");--> statement-breakpoint

-- The platform Customer id. `0001` removed `user.stripe_customer_id` because
-- there was no platform customer; platform billing is exactly that case now, and
-- this id is a different thing from a customer on a creator's connected account.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;--> statement-breakpoint

-- No backfill is possible or wanted: `creator_entitlements` was written by the
-- hand-rolled checkout that never completed a real payment, and the plugin
-- rebuilds the row from Stripe on the first webhook. Dropping it loses no
-- entitlement anyone actually paid for.
DROP TABLE IF EXISTS "creator_entitlements";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."creator_subscription_status";
