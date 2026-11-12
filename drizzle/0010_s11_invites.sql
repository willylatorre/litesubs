ALTER TABLE "invites" ADD COLUMN "comp_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "plan_version_id" text;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE set null ON UPDATE no action;