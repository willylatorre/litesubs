CREATE INDEX IF NOT EXISTS "invite_email_status_idx" ON "invites" USING btree ("email","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_creator_active_idx" ON "products" USING btree ("creator_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_user_type_idx" ON "transactions" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tx_creator_type_idx" ON "transactions" USING btree ("creator_id","type");
