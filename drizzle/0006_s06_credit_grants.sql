-- S06: grant-aware, retry-safe consumption.
--
-- Credits move from one undifferentiated `enrollments.credits` counter to real
-- **grants** that each hold a remaining amount and an optional expiry. Spending
-- then allocates across grants, so a debit is attributable to the pack it came
-- from and an expired allowance stops being spendable on read (no cron needed).
--
-- `enrollments.credits` survives as a projection kept in step by the same
-- transaction; it is never the source of truth for what may be spent.
--
-- Backfill matters as much as the schema: every existing balance becomes one
-- grant, otherwise the migration would silently strand credits that customers
-- already paid for. The grant is source-linked to each enrollment's most recent
-- positive ledger row when one exists, so history stays connected.
CREATE TYPE "public"."grant_kind" AS ENUM('purchase', 'comp', 'adjustment', 'period');--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'expiry';--> statement-breakpoint
CREATE TABLE "credit_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_allocation_amount_positive" CHECK ("credit_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version_id" text,
	"source_transaction_id" text,
	"kind" "grant_kind" NOT NULL,
	"amount" integer NOT NULL,
	"remaining" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grant_amount_positive" CHECK ("credit_grants"."amount" > 0),
	CONSTRAINT "credit_grant_remaining_bounded" CHECK ("credit_grants"."remaining" >= 0 and "credit_grants"."remaining" <= "credit_grants"."amount")
);
--> statement-breakpoint
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_grant_id_credit_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."credit_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_allocation_transaction_idx" ON "credit_allocations" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "credit_allocation_grant_idx" ON "credit_allocations" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "credit_allocation_creator_idx" ON "credit_allocations" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "credit_grant_enrollment_idx" ON "credit_grants" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "credit_grant_creator_idx" ON "credit_grants" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "credit_grant_user_idx" ON "credit_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_grant_expiry_idx" ON "credit_grants" USING btree ("expires_at");
--> statement-breakpoint
-- One non-expiring grant per enrollment, carrying its current spendable balance.
-- `adjustment` is the honest kind: these units predate grant tracking and we
-- cannot prove which purchase produced each remaining unit.
INSERT INTO "credit_grants" (
	"id", "enrollment_id", "creator_id", "user_id", "plan_id",
	"plan_version_id", "source_transaction_id", "kind",
	"amount", "remaining", "expires_at", "created_at"
)
SELECT
	'backfill_' || e."id",
	e."id",
	e."creator_id",
	e."user_id",
	e."plan_id",
	latest."plan_version_id",
	latest."id",
	'adjustment'::"grant_kind",
	e."credits",
	e."credits",
	NULL,
	now()
FROM "enrollments" e
LEFT JOIN LATERAL (
	SELECT t."id", t."plan_version_id"
	FROM "transactions" t
	WHERE t."user_id" = e."user_id"
		AND t."plan_id" = e."plan_id"
		AND t."amount" > 0
	ORDER BY t."created_at" DESC, t."id" DESC
	LIMIT 1
) latest ON true
WHERE e."credits" > 0;
