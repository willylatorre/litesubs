ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "stripe_checkout_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "transactions" ADD CONSTRAINT "transactions_stripe_checkout_id_unique" UNIQUE("stripe_checkout_id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
