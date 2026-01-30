DO $$ BEGIN
	CREATE TYPE "public"."transaction_status" AS ENUM('ongoing', 'completed', 'declined');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "status" "transaction_status" DEFAULT 'ongoing' NOT NULL;
