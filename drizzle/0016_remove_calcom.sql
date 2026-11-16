-- Retire the Cal.com vendor integration.
--
-- Native booking schedules replaced it: a plan is now linked through
-- `booking_schedules.plan_id`, which is the same relationship in the opposite
-- direction. Keeping the vendor tables would leave a parallel, unusable path.
--
-- Order matters: `plans.integration_id` references `integrations`, and
-- `integrations.calcom_integration_id` references `calcom_integrations`, so the
-- dependants are dropped first.
--
-- This drops OAuth connections and event-type metadata only. No plan, price,
-- enrollment, credit, booking, or payment row is touched: none of them ever held
-- a foreign key into these tables.
ALTER TABLE "plans" DROP COLUMN IF EXISTS "integration_id";--> statement-breakpoint
DROP TABLE IF EXISTS "integrations";--> statement-breakpoint
DROP TABLE IF EXISTS "calcom_integrations";--> statement-breakpoint
DROP TABLE IF EXISTS "cal_com_accounts";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."integration_type";
