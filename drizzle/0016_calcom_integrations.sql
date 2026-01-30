DO $$ BEGIN
	CREATE TYPE "integration_type" AS ENUM ('calcom');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "products"
	DROP COLUMN IF EXISTS "cal_event_type_id",
	DROP COLUMN IF EXISTS "cal_event_type_slug",
	DROP COLUMN IF EXISTS "cal_event_type_name",
	DROP COLUMN IF EXISTS "cal_event_type_url",
	DROP COLUMN IF EXISTS "cal_connected_at";

CREATE TABLE IF NOT EXISTS "calcom_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type_id" integer,
	"event_type_slug" text,
	"event_type_name" text,
	"event_type_url" text,
	"connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"type" integration_type NOT NULL,
	"calcom_integration_id" text REFERENCES "calcom_integrations"("id") ON DELETE cascade,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "products"
	ADD COLUMN IF NOT EXISTS "integration_id" text REFERENCES "integrations"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "calcom_event_type_id_idx" ON "calcom_integrations" ("event_type_id");
CREATE INDEX IF NOT EXISTS "calcom_event_type_slug_idx" ON "calcom_integrations" ("event_type_slug");
CREATE INDEX IF NOT EXISTS "integrations_user_idx" ON "integrations" ("user_id");
CREATE INDEX IF NOT EXISTS "integrations_type_idx" ON "integrations" ("type");
