ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "amount_money" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "currency" "currency";
