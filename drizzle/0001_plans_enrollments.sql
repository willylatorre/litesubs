-- S01: rename the credit-domain tables and split commercial terms into
-- immutable plan versions. Additive only: no table is dropped and existing
-- accounts, enrollments, and ledger rows keep their identity.
--
-- Every pre-existing plan keeps selling exactly what it sold before, so its
-- former price/credits become version 1. A plan that was previously disabled
-- becomes a draft instead, because drafts are the new "not purchasable" state.

ALTER TYPE "public"."product_type" RENAME TO "billing_mode";
--> statement-breakpoint

CREATE TYPE "public"."billing_interval" AS ENUM('month');
--> statement-breakpoint
CREATE TYPE "public"."plan_version_status" AS ENUM('draft', 'published', 'superseded');
--> statement-breakpoint

ALTER TABLE "products" RENAME TO "plans";
--> statement-breakpoint
ALTER TABLE "lite_subscriptions" RENAME TO "enrollments";
--> statement-breakpoint
ALTER TABLE "enrollments" RENAME CONSTRAINT "user_product_unique" TO "user_plan_unique";
--> statement-breakpoint
ALTER TABLE "enrollments" RENAME CONSTRAINT "lite_subscriptions_credits_non_negative" TO "enrollment_credits_non_negative";
--> statement-breakpoint
ALTER INDEX "lite_subscriptions_user_idx" RENAME TO "enrollment_user_idx";
--> statement-breakpoint
ALTER INDEX "lite_subscriptions_product_idx" RENAME TO "enrollment_plan_idx";
--> statement-breakpoint
ALTER INDEX "lite_subscriptions_creator_idx" RENAME TO "enrollment_creator_idx";
--> statement-breakpoint
ALTER INDEX "product_creator_idx" RENAME TO "plan_creator_idx";
--> statement-breakpoint
ALTER INDEX "product_created_at_idx" RENAME TO "plan_created_at_idx";
--> statement-breakpoint
-- Availability now comes from the latest plan version, not a mutable boolean.
DROP INDEX IF EXISTS "product_creator_active_idx";
--> statement-breakpoint

-- Constraint names are not renamed automatically with the tables.
ALTER TABLE "enrollments" RENAME CONSTRAINT "lite_subscriptions_pkey" TO "enrollments_pkey";
--> statement-breakpoint
ALTER TABLE "enrollments" RENAME CONSTRAINT "lite_subscriptions_user_id_user_id_fk" TO "enrollments_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "enrollments" RENAME CONSTRAINT "lite_subscriptions_product_id_products_id_fk" TO "enrollments_plan_id_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "enrollments" RENAME CONSTRAINT "lite_subscriptions_creator_id_user_id_fk" TO "enrollments_creator_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "plans" RENAME CONSTRAINT "products_pkey" TO "plans_pkey";
--> statement-breakpoint
ALTER TABLE "plans" RENAME CONSTRAINT "products_creator_id_user_id_fk" TO "plans_creator_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "plans" RENAME CONSTRAINT "products_integration_id_integrations_id_fk" TO "plans_integration_id_integrations_id_fk";
--> statement-breakpoint
ALTER TABLE "invites" RENAME CONSTRAINT "invites_product_id_products_id_fk" TO "invites_plan_id_plans_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" RENAME CONSTRAINT "transactions_product_id_products_id_fk" TO "transactions_plan_id_plans_id_fk";
--> statement-breakpoint

ALTER TABLE "invites" RENAME COLUMN "product_id" TO "plan_id";
--> statement-breakpoint
ALTER TABLE "transactions" RENAME COLUMN "product_id" TO "plan_id";
--> statement-breakpoint
ALTER INDEX "tx_product_idx" RENAME TO "tx_plan_idx";
--> statement-breakpoint
ALTER TABLE "enrollments" RENAME COLUMN "product_id" TO "plan_id";
--> statement-breakpoint

CREATE TABLE "plan_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"status" "plan_version_status" DEFAULT 'draft' NOT NULL,
	"billing_mode" "billing_mode" NOT NULL,
	"interval" "billing_interval",
	"currency" "currency" DEFAULT 'usd' NOT NULL,
	"price" integer NOT NULL,
	"credits" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_version_number_unique" UNIQUE("plan_id","version"),
	CONSTRAINT "plan_version_price_non_negative" CHECK ("price" >= 0),
	CONSTRAINT "plan_version_credits_positive" CHECK ("credits" > 0),
	CONSTRAINT "plan_version_interval_matches_mode" CHECK (("billing_mode" = 'one_time' and "interval" is null) or ("billing_mode" = 'recurring' and "interval" = 'month'))
);
--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "plan_version_plan_idx" ON "plan_versions" USING btree ("plan_id");
--> statement-breakpoint
CREATE INDEX "plan_version_creator_idx" ON "plan_versions" USING btree ("creator_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "plan_version_single_draft_idx" ON "plan_versions" USING btree ("plan_id") WHERE "plan_versions"."status" = 'draft';
--> statement-breakpoint

-- Term columns still exist here, so capture them before dropping.
INSERT INTO "plan_versions" ("id", "plan_id", "creator_id", "status", "billing_mode", "interval", "currency", "price", "credits", "version", "published_at")
SELECT
	'pv_' || "id",
	"id",
	"creator_id",
	CASE WHEN "active" THEN 'published'::"plan_version_status" ELSE 'draft'::"plan_version_status" END,
	CASE WHEN "type" = 'recurring' THEN 'recurring'::"billing_mode" ELSE 'one_time'::"billing_mode" END,
	CASE WHEN "type" = 'recurring' THEN 'month'::"billing_interval" ELSE NULL END,
	"currency",
	"price",
	"credits",
	1,
	CASE WHEN "active" THEN now() ELSE NULL END
FROM "plans";
--> statement-breakpoint

-- Platform Stripe Customers are retired: billing belongs to each creator's
-- connected account, so no account-wide customer id remains.
ALTER TABLE "user" DROP COLUMN IF EXISTS "stripe_customer_id";
--> statement-breakpoint

-- Commercial terms no longer live on the editable plan row.
ALTER TABLE "plans" DROP COLUMN "price";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "currency";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "credits";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "type";
--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "active";
--> statement-breakpoint
