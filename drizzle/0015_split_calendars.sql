-- Split the single Google calendar setting into two distinct roles:
--   busy_calendar_id  — whose existing events block bookable slots
--   write_calendar_id — where a booking's event is written
--
-- A creator typically wants their main calendar to keep them honest about being
-- busy, while bookings land somewhere dedicated rather than flooding their
-- personal calendar. The old code used one id for both.
--
-- Existing connections keep working: the old id is carried into both columns, so
-- behaviour is unchanged until the creator picks something else.
ALTER TABLE "calendar_connections"
	ADD COLUMN "busy_calendar_id" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_connections"
	ADD COLUMN "write_calendar_id" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_connections"
	ADD COLUMN "write_calendar_created" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Preserve whatever each creator had already chosen.
UPDATE "calendar_connections"
SET "busy_calendar_id" = "calendar_id",
    "write_calendar_id" = "calendar_id";--> statement-breakpoint

ALTER TABLE "calendar_connections" DROP COLUMN "calendar_id";
