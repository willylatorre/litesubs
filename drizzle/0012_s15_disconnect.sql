CREATE TYPE "public"."subscription_cancellation_cause" AS ENUM('customer', 'creator_disconnect');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancellation_cause" "subscription_cancellation_cause";--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "disconnect_failure" text;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "disconnect_attempted_at" timestamp with time zone;