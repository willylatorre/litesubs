DO $$ BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'creator_payout_accounts'
			AND column_name = 'stripe_account_id'
	) AND NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'creator_payout_accounts'
			AND column_name = 'stripe_recipient_id'
	) THEN
		EXECUTE 'ALTER TABLE "creator_payout_accounts" RENAME COLUMN "stripe_account_id" TO "stripe_recipient_id"';
	END IF;
END $$;
