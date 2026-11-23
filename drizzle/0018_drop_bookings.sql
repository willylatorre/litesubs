-- Move bookings out of Litesubs.
--
-- Scheduling now lives in Plannerie. See `docs/REFOCUS.md`: Litesubs keeps the
-- price, the credit grant, and the ledger; availability, slots, and calendar
-- sync belong with the teacher's lesson workspace.
--
-- This is a greenfield removal: there is no production schedule or booking to
-- preserve. The tables are dropped rather than migrated, and the shared
-- `/book/<creator>/<slug>` route redirects to Plannerie so an already-sent link
-- does not 404.
--
-- Dropping order follows the foreign keys: `bookings` references
-- `booking_schedules`, and each schedule owns its availability and exceptions.
-- `notifications` is dropped with them because every row it ever wrote came from
-- a booking event (confirmed, cancelled, starting-soon); no other feature uses
-- the bell.
--
-- Nothing in the money path depends on these tables. `plans`, `plan_versions`,
-- `enrollments`, `credit_grants`, `credit_allocations`, `transactions`,
-- `payments`, `refunds`, `subscriptions`, and `subscription_invoices` are
-- untouched, so balances and history survive verbatim.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "booking_no_overlap_per_creator";--> statement-breakpoint
DROP TABLE IF EXISTS "bookings";--> statement-breakpoint
DROP TABLE IF EXISTS "booking_availability";--> statement-breakpoint
DROP TABLE IF EXISTS "booking_exceptions";--> statement-breakpoint
DROP TABLE IF EXISTS "booking_schedules";--> statement-breakpoint
DROP TABLE IF EXISTS "calendar_connections";--> statement-breakpoint
DROP TABLE IF EXISTS "notifications";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."booking_status";
