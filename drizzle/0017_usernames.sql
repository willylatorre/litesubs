-- Add Better Auth's normalized public username without deriving one from an
-- email address. Existing accounts stay NULL until their owner chooses a
-- permanent username; Postgres' unique constraint still permits multiple NULLs.
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");
