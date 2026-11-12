-- S05: creator-owned purchases through direct-charge Checkout.
--
-- Additive only. Three new tables carry the purchase pipeline:
--
--   creator_customers — the buyer's Stripe Customer *on each creator's account*.
--     Stripe Customers are account-scoped, so this mapping is what lets a
--     purchase reuse one intended Customer without ever passing a platform
--     Customer to a connected account. The unique (creator, user) constraint
--     resolves concurrent first-purchase races in the database.
--   payments — one row per Checkout attempt: intended terms, amount charged,
--     application fee, and the account the charge belongs to. It is the receipt
--     and the fulfillment idempotency boundary.
--   checkout_tokens — single-use, authenticated purchase requests. Only a hash
--     is stored, so a database dump cannot replay a forwarded link.
--
-- `transactions.plan_version_id` source-links a credit movement to the immutable
-- terms it belongs to, so a later price change never rewrites history.
CREATE TYPE "public"."customer_provisioning" AS ENUM('provisioning', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'refunded');--> statement-breakpoint
CREATE TABLE "checkout_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "creator_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"stripe_account_id" text,
	"stripe_customer_id" text,
	"status" "customer_provisioning" DEFAULT 'provisioning' NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_customer_unique" UNIQUE("creator_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_checkout_id" text,
	"stripe_payment_intent_id" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"credits" integer NOT NULL,
	"amount_total" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"application_fee" integer NOT NULL,
	"amount_paid" integer,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_checkout_id_unique" UNIQUE("stripe_checkout_id"),
	CONSTRAINT "payment_amounts_non_negative" CHECK ("payments"."amount_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "plan_version_id" text;--> statement-breakpoint
ALTER TABLE "checkout_tokens" ADD CONSTRAINT "checkout_tokens_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_tokens" ADD CONSTRAINT "checkout_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_tokens" ADD CONSTRAINT "checkout_tokens_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_customers" ADD CONSTRAINT "creator_customers_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_customers" ADD CONSTRAINT "creator_customers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_token_creator_idx" ON "checkout_tokens" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "checkout_token_expiry_idx" ON "checkout_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "creator_customer_creator_idx" ON "creator_customers" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "creator_customer_user_idx" ON "creator_customers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_customer_stripe_unique" ON "creator_customers" USING btree ("stripe_account_id","stripe_customer_id") WHERE "creator_customers"."stripe_customer_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_creator_idx" ON "payments" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "payment_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_plan_idx" ON "payments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "payment_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_plan_version_idx" ON "transactions" USING btree ("plan_version_id");