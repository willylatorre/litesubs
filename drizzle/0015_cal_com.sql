ALTER TABLE "products"
	ADD COLUMN IF NOT EXISTS "cal_event_type_id" integer,
	ADD COLUMN IF NOT EXISTS "cal_event_type_slug" text,
	ADD COLUMN IF NOT EXISTS "cal_event_type_name" text,
	ADD COLUMN IF NOT EXISTS "cal_event_type_url" text,
	ADD COLUMN IF NOT EXISTS "cal_connected_at" timestamp;

CREATE TABLE IF NOT EXISTS "cal_com_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"scope" text,
	"cal_user_id" text,
	"cal_username" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cal_com_accounts_user_id_unique" UNIQUE("user_id")
);
