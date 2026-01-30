DO $$ BEGIN
	CREATE TYPE "public"."currency" AS ENUM('usd', 'eur');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "currency" "currency" DEFAULT 'usd' NOT NULL;
