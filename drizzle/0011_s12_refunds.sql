CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text,
	"subscription_invoice_id" text,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"stripe_account_id" text NOT NULL,
	"stripe_refund_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" "currency" NOT NULL,
	"revoked_credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_amount_positive" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refund_revoked_non_negative" CHECK ("refunds"."revoked_credits" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount_refunded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN "amount_refunded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "subscription_invoice_id" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_subscription_invoice_id_subscription_invoices_id_fk" FOREIGN KEY ("subscription_invoice_id") REFERENCES "public"."subscription_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_account_id_unique" ON "refunds" USING btree ("stripe_account_id","stripe_refund_id");--> statement-breakpoint
CREATE INDEX "refund_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refund_creator_idx" ON "refunds" USING btree ("creator_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_subscription_invoice_id_subscription_invoices_id_fk" FOREIGN KEY ("subscription_invoice_id") REFERENCES "public"."subscription_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_subscription_invoice_idx" ON "transactions" USING btree ("subscription_invoice_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payment_refunded_bounded" CHECK ("payments"."amount_refunded" >= 0 and ("payments"."amount_paid" is null or "payments"."amount_refunded" <= "payments"."amount_paid"));--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoice_refunded_bounded" CHECK ("subscription_invoices"."amount_refunded" >= 0 and "subscription_invoices"."amount_refunded" <= "subscription_invoices"."amount_paid");