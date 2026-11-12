CREATE TYPE "public"."subscription_status" AS ENUM('pending', 'incomplete', 'active', 'canceled');--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"amount_paid" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"credited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoice_amount_non_negative" CHECK ("subscription_invoices"."amount_paid" >= 0),
	CONSTRAINT "subscription_invoice_period_valid" CHECK ("subscription_invoices"."period_end" > "subscription_invoices"."period_start")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_checkout_id" text,
	"stripe_subscription_id" text,
	"status" "subscription_status" DEFAULT 'pending' NOT NULL,
	"application_fee_percent" integer NOT NULL,
	"paid_through_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_checkout_id_unique" UNIQUE("stripe_checkout_id"),
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "subscription_fee_percent_positive" CHECK ("subscriptions"."application_fee_percent" > 0 and "subscriptions"."application_fee_percent" < 100)
);
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoice_account_id_unique" ON "subscription_invoices" USING btree ("stripe_account_id","stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "subscription_invoice_subscription_idx" ON "subscription_invoices" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_creator_idx" ON "subscriptions" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "subscription_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_plan_idx" ON "subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_one_live_per_customer_plan_idx" ON "subscriptions" USING btree ("creator_id","user_id","plan_id") WHERE "subscriptions"."status" in ('pending', 'incomplete', 'active');
