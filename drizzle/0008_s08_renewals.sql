ALTER TYPE "public"."subscription_status" ADD VALUE 'past_due' BEFORE 'canceled';--> statement-breakpoint
DROP INDEX "subscription_one_live_per_customer_plan_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoice_period_unique" ON "subscription_invoices" USING btree ("subscription_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_one_live_per_customer_plan_idx" ON "subscriptions" USING btree ("creator_id","user_id","plan_id") WHERE "subscriptions"."status" <> 'canceled';
