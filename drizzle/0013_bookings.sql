CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TABLE "booking_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "booking_availability_weekday_range" CHECK ("booking_availability"."weekday" >= 0 and "booking_availability"."weekday" <= 6),
	CONSTRAINT "booking_availability_minutes_range" CHECK ("booking_availability"."start_minute" >= 0 and "booking_availability"."end_minute" <= 1440),
	CONSTRAINT "booking_availability_window_ordered" CHECK ("booking_availability"."end_minute" > "booking_availability"."start_minute")
);
--> statement-breakpoint
CREATE TABLE "booking_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	CONSTRAINT "booking_exception_range_ordered" CHECK ("booking_exceptions"."ends_at" > "booking_exceptions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "booking_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"plan_id" text,
	"credits_per_booking" integer,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"horizon_days" integer DEFAULT 60 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_schedule_creator_slug_unique" UNIQUE("creator_id","slug"),
	CONSTRAINT "booking_schedule_credits_positive" CHECK ("booking_schedules"."credits_per_booking" is null or "booking_schedules"."credits_per_booking" > 0),
	CONSTRAINT "booking_schedule_duration_positive" CHECK ("booking_schedules"."duration_minutes" > 0),
	CONSTRAINT "booking_schedule_buffers_non_negative" CHECK ("booking_schedules"."buffer_before_minutes" >= 0 and "booking_schedules"."buffer_after_minutes" >= 0),
	CONSTRAINT "booking_schedule_horizon_positive" CHECK ("booking_schedules"."horizon_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"charged_credits" integer DEFAULT 0 NOT NULL,
	"charge_transaction_id" text,
	"refund_transaction_id" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"external_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_range_ordered" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "booking_charged_non_negative" CHECK ("bookings"."charged_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"external_account_email" text,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"sync_failure" text,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connection_creator_provider_unique" UNIQUE("creator_id","provider")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_user_dedupe_unique" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "booking_availability" ADD CONSTRAINT "booking_availability_schedule_id_booking_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."booking_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_availability" ADD CONSTRAINT "booking_availability_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_exceptions" ADD CONSTRAINT "booking_exceptions_schedule_id_booking_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."booking_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_exceptions" ADD CONSTRAINT "booking_exceptions_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_schedules" ADD CONSTRAINT "booking_schedules_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_schedules" ADD CONSTRAINT "booking_schedules_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_schedule_id_booking_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."booking_schedules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_availability_schedule_idx" ON "booking_availability" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "booking_exception_schedule_idx" ON "booking_exceptions" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "booking_schedule_creator_idx" ON "booking_schedules" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "booking_schedule_plan_idx" ON "booking_schedules" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "booking_schedule_idx" ON "bookings" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "booking_creator_idx" ON "bookings" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "booking_user_idx" ON "bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "booking_starts_idx" ON "bookings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "calendar_connection_creator_idx" ON "calendar_connections" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notifications" USING btree ("created_at");
--> statement-breakpoint
-- Overlap prevention cannot be expressed in the Drizzle schema, and a
-- read-then-insert check loses under concurrency. `btree_gist` lets one GiST
-- exclusion cover equality on creator_id plus range overlap on the booking's
-- UTC interval, so two confirmed bookings can never occupy the same time for
-- the same creator. Cancelled/time-ended rows are excluded from the constraint
-- so history is kept without reserving the slot forever.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "booking_no_overlap_per_creator"
	EXCLUDE USING gist (
		"creator_id" WITH =,
		tstzrange("starts_at", "ends_at") WITH &&
	)
	WHERE ("status" = 'confirmed');
