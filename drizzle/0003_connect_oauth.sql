-- S03: support connecting an existing Stripe business through Connect OAuth.
--
-- Accounts obtained this way are self-controlled, so the row records that the
-- authorization came from OAuth (only those can be deauthorized at Stripe) and
-- which mode it was granted in. Existing rows default to the safe values: not
-- OAuth-authorized, mode unknown.

ALTER TABLE "connected_accounts" ADD COLUMN "authorized_via_oauth" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD COLUMN "livemode" boolean;
--> statement-breakpoint
-- Per-capability state. Direct charges require card_payments specifically, and
-- older rows have no snapshot of it, so it stays null until the next sync.
ALTER TABLE "connected_accounts" ADD COLUMN "card_payments_status" text;
--> statement-breakpoint

-- Single-use OAuth state. Only the hash is stored: the raw value travels in a
-- browser URL and a database dump must not be replayable.
CREATE TABLE "connect_oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connect_oauth_states_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "connect_oauth_states" ADD CONSTRAINT "connect_oauth_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "connect_oauth_state_user_idx" ON "connect_oauth_states" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "connect_oauth_state_expiry_idx" ON "connect_oauth_states" USING btree ("expires_at");
--> statement-breakpoint
