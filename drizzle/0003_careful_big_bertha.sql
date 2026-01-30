CREATE INDEX IF NOT EXISTS "invite_creator_idx" ON "invites" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_email_idx" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_creator_idx" ON "products" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_created_at_idx" ON "products" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_product_idx" ON "transactions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_created_at_idx" ON "transactions" USING btree ("created_at");
