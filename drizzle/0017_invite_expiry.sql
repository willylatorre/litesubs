-- Invite links previously never expired, so a shared or leaked URL stayed
-- claimable indefinitely. Give every invite a 14-day lifetime.
ALTER TABLE "invites"
	ADD COLUMN IF NOT EXISTS "expires_at" timestamp DEFAULT (now() + interval '14 days') NOT NULL;
