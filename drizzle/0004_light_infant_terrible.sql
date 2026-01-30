ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "product_id" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "invites" ADD CONSTRAINT "invites_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
