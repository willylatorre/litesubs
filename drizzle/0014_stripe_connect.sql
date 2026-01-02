-- Stripe Connect Integration Migration
-- Adds support for creators to connect their own Stripe accounts

-- Enum for Stripe Connect account status
CREATE TYPE "public"."stripe_connect_status" AS ENUM('pending', 'active', 'restricted', 'disabled');--> statement-breakpoint

-- Enum for payout method preference
CREATE TYPE "public"."payout_method" AS ENUM('stripe_connect', 'platform_payouts');--> statement-breakpoint

-- Table for Stripe Connect account information
CREATE TABLE "stripe_connect_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"account_type" text DEFAULT 'express' NOT NULL,
	"status" "stripe_connect_status" DEFAULT 'pending' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"details_submitted" boolean DEFAULT false NOT NULL,
	"country" text,
	"default_currency" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_connect_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "stripe_connect_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id")
);--> statement-breakpoint

-- Table for user payout method preferences
CREATE TABLE "user_payout_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"method" "payout_method" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_payout_preferences_user_id_unique" UNIQUE("user_id")
);--> statement-breakpoint

-- Add Stripe Connect columns to transactions table
ALTER TABLE "transactions" ADD COLUMN "uses_stripe_connect" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "stripe_application_fee" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "stripe_connect_account_id" text;--> statement-breakpoint

-- Foreign key constraints
ALTER TABLE "stripe_connect_accounts" ADD CONSTRAINT "stripe_connect_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_payout_preferences" ADD CONSTRAINT "user_payout_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Indexes for efficient queries
CREATE INDEX "stripe_connect_user_idx" ON "stripe_connect_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stripe_connect_account_idx" ON "stripe_connect_accounts" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "payout_pref_user_idx" ON "user_payout_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tx_uses_connect_idx" ON "transactions" USING btree ("uses_stripe_connect");
