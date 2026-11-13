CREATE TABLE "cal_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_uid" text NOT NULL,
	"creator_id" text NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"calcom_integration_id" text,
	"charge_transaction_id" text,
	"charged_credits" integer DEFAULT 0 NOT NULL,
	"refund_transaction_id" text,
	"cancelled_at" timestamp with time zone,
	"starts_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cal_bookings_booking_uid_unique" UNIQUE("booking_uid"),
	CONSTRAINT "cal_booking_charged_non_negative" CHECK ("cal_bookings"."charged_credits" >= 0)
);
--> statement-breakpoint
ALTER TABLE "calcom_integrations" ADD COLUMN "credits_per_booking" integer;--> statement-breakpoint
ALTER TABLE "cal_bookings" ADD CONSTRAINT "cal_bookings_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_bookings" ADD CONSTRAINT "cal_bookings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_bookings" ADD CONSTRAINT "cal_bookings_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_bookings" ADD CONSTRAINT "cal_bookings_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cal_bookings" ADD CONSTRAINT "cal_bookings_calcom_integration_id_calcom_integrations_id_fk" FOREIGN KEY ("calcom_integration_id") REFERENCES "public"."calcom_integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cal_booking_creator_idx" ON "cal_bookings" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "cal_booking_user_idx" ON "cal_bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cal_booking_plan_idx" ON "cal_bookings" USING btree ("plan_id");--> statement-breakpoint
ALTER TABLE "calcom_integrations" ADD CONSTRAINT "calcom_credits_per_booking_positive" CHECK ("calcom_integrations"."credits_per_booking" is null or "calcom_integrations"."credits_per_booking" > 0);