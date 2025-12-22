CREATE TYPE "public"."currency" AS ENUM('usd', 'eur');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "currency" "currency" DEFAULT 'usd' NOT NULL;