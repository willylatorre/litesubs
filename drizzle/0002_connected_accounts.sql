-- S02: replace the express/account-type Connect model with an explicit
-- connected account that records the agreed responsibilities and readiness.
--
-- Existing Connect accounts are migrated, not dropped. Accounts created by the
-- old Express flow are recorded as `connected` (they already exist at Stripe)
-- and keep their real capability flags; nothing about them is assumed to be
-- more ready than Stripe already reported.

CREATE TYPE "public"."account_status" AS ENUM('pending', 'active', 'restricted', 'disabled');
--> statement-breakpoint
CREATE TYPE "public"."account_onboarding_mode" AS ENUM('created', 'connected');
--> statement-breakpoint

CREATE TABLE "connected_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"onboarding_mode" "account_onboarding_mode" NOT NULL,
	"status" "account_status" DEFAULT 'pending' NOT NULL,
	"controller_type" text,
	"dashboard_type" text,
	"fees_payer" text,
	"losses_payments" text,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"country" text,
	"default_currency" text,
	"requirements_currently_due" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_disabled_reason" text,
	"last_synced_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connected_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "connected_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "connected_account_user_idx" ON "connected_accounts" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "connected_account_stripe_idx" ON "connected_accounts" USING btree ("stripe_account_id");
--> statement-breakpoint

-- Carry over any existing Connect accounts. Their agreed responsibilities were
-- whatever the old Express account actually used, so record that rather than
-- claiming the new configuration; the creator is asked to re-confirm readiness.
INSERT INTO "connected_accounts" (
	"id", "user_id", "stripe_account_id", "onboarding_mode", "status",
	"controller_type", "dashboard_type", "fees_payer", "losses_payments",
	"charges_enabled", "payouts_enabled", "details_submitted", "country",
	"default_currency", "created_at", "updated_at"
)
SELECT
	"id",
	"user_id",
	"stripe_account_id",
	'connected',
	"status"::text::"account_status",
	'application',
	CASE WHEN "account_type" = 'express' THEN 'express' ELSE 'full' END,
	'account',
	'application',
	"charges_enabled",
	"payouts_enabled",
	"details_submitted",
	"country",
	"default_currency",
	"created_at",
	"updated_at"
FROM "stripe_connect_accounts";
--> statement-breakpoint

-- Platform payout plumbing is retired: no earnings ledger, no payout requests,
-- no payout-method preference. Stripe owns payout scheduling on the account.
DROP TABLE IF EXISTS "earnings_ledger";
--> statement-breakpoint
DROP TABLE IF EXISTS "payouts";
--> statement-breakpoint
DROP TABLE IF EXISTS "creator_payout_accounts";
--> statement-breakpoint
DROP TABLE IF EXISTS "user_payout_preferences";
--> statement-breakpoint
DROP TABLE IF EXISTS "stripe_connect_accounts";
--> statement-breakpoint

DROP TYPE IF EXISTS "public"."earnings_transaction_type";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."payout_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."payout_verification_status";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."payout_method";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."stripe_connect_status";
--> statement-breakpoint
