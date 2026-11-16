CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"last_error" text,
	"last_attempted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_attempts_non_negative" CHECK ("webhook_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"response_status" integer,
	"error" text,
	"duration_ms" integer,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_attempt_outcome_valid" CHECK ("webhook_delivery_attempts"."outcome" in ('succeeded', 'failed')),
	CONSTRAINT "webhook_attempt_number_positive" CHECK ("webhook_delivery_attempts"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"signing_secret" text NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoint_events_not_empty" CHECK (cardinality("webhook_endpoints"."events") > 0)
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_endpoint_event_unique" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_creator_idx" ON "webhook_deliveries" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_attempt_delivery_number_unique" ON "webhook_delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "webhook_attempt_creator_idx" ON "webhook_delivery_attempts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_creator_idx" ON "webhook_endpoints" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoint_creator_url_unique" ON "webhook_endpoints" USING btree ("creator_id","url");