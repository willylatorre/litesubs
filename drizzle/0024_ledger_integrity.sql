-- T066: make the ledger's two guarantees facts the database enforces.
--
--   1. One ledger row grants credits at most once.
--   2. A committed ledger row cannot be rewritten.
--
-- Both are recorded here rather than only in the write paths because a guarantee
-- that lives in application code holds only while one writer runs. Stripe
-- delivers duplicates concurrently, and nothing in a sequential unit test sees
-- the second grant that a parallel delivery creates.

-- ---------------------------------------------------------------------------
-- 1. Unique grant per source ledger row
-- ---------------------------------------------------------------------------
-- `credit_grants.source_transaction_id` linked a grant to its ledger row, but
-- nothing stopped a *second* grant naming the same row. Two deliveries that both
-- reach the insert before either commits both succeed, and the customer is
-- credited twice for one payment.
--
-- Partial on purpose: rows written before 0006's backfill and any comp created
-- outside a ledger row carry no source, and `null` never conflicts with `null`
-- in a unique index — the predicate states that intent instead of implying it.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_grant_source_unique_idx" ON "credit_grants" USING btree ("source_transaction_id") WHERE "credit_grants"."source_transaction_id" is not null;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The operation audit is append-only
-- ---------------------------------------------------------------------------
-- `transactions` is the record of what happened to a customer's money and
-- `credit_allocations` is where every debit went. They were mutable in place:
-- the refund and expiry paths depend on `credit_grants.remaining` moving, but
-- neither ever needs to rewrite the ledger row that created it or the allocation
-- that consumed it. Historical corrections are new rows, not edits — that is
-- what makes the balance reproducible from the ledger months later.
--
-- `UPDATE` only; `DELETE` stays legal because a user erasure cascades through
-- FKs (`transactions.user_id`, `enrollments.id`), and blocking it would make the
-- account-deletion path fail rather than work. The foreign keys that point at
-- plans and versions are `ON DELETE SET NULL`; Postgres implements those as an
-- UPDATE of the referencing row, so the trigger permits a nulling of exactly
-- those columns. Refusing it would break the sample-workspace cleanup, which
-- deletes a demo plan that a demo ledger row references.
CREATE OR REPLACE FUNCTION "litesubs_refuse_allocated_credit_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."grant_id" IS DISTINCT FROM OLD."grant_id"
		OR NEW."amount" IS DISTINCT FROM OLD."amount"
		OR NEW."transaction_id" IS DISTINCT FROM OLD."transaction_id"
	THEN
		RAISE EXCEPTION
			'credit_allocations is an append-only ledger: row % cannot be rewritten', OLD."id"
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "litesubs_refuse_ledger_rewrite"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	-- The only permitted change is a foreign key nulling itself when its target
	-- is removed: `plan_id`, `plan_version_id` and `subscription_invoice_id` are
	-- all declared `ON DELETE SET NULL`, and Postgres implements that as an UPDATE
	-- of the referencing row. Each transition is narrowed to non-null -> null so a
	-- rewritten pointer is still refused. Everything that describes the movement —
	-- parties, amount, money, balances, kind, description — is frozen.
	IF NEW."amount" IS DISTINCT FROM OLD."amount"
		OR NEW."amount_money" IS DISTINCT FROM OLD."amount_money"
		OR NEW."currency" IS DISTINCT FROM OLD."currency"
		OR NEW."type" IS DISTINCT FROM OLD."type"
		OR NEW."status" IS DISTINCT FROM OLD."status"
		OR NEW."description" IS DISTINCT FROM OLD."description"
		OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
		OR NEW."creator_id" IS DISTINCT FROM OLD."creator_id"
		OR NEW."balance_before" IS DISTINCT FROM OLD."balance_before"
		OR NEW."balance_after" IS DISTINCT FROM OLD."balance_after"
		OR (NEW."plan_id" IS DISTINCT FROM OLD."plan_id" AND NEW."plan_id" IS NOT NULL)
		OR (
			NEW."plan_version_id" IS DISTINCT FROM OLD."plan_version_id"
			AND NEW."plan_version_id" IS NOT NULL
		)
		OR (
			NEW."subscription_invoice_id" IS DISTINCT FROM OLD."subscription_invoice_id"
			AND NEW."subscription_invoice_id" IS NOT NULL
		)
	THEN
		RAISE EXCEPTION
			'transactions is an append-only ledger: row % cannot be rewritten; record a new row instead', OLD."id"
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "transactions_append_only" ON "transactions";--> statement-breakpoint
CREATE TRIGGER "transactions_append_only"
	BEFORE UPDATE ON "transactions"
	FOR EACH ROW EXECUTE FUNCTION "litesubs_refuse_ledger_rewrite"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "credit_allocations_append_only" ON "credit_allocations";--> statement-breakpoint
CREATE TRIGGER "credit_allocations_append_only"
	BEFORE UPDATE ON "credit_allocations"
	FOR EACH ROW EXECUTE FUNCTION "litesubs_refuse_allocated_credit_change"();
