"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { setupPayoutAccount } from "@/app/actions/payouts";
import { Button } from "@/components/ui/button";
import type { PayoutAccount } from "./payout-balance-card";

interface SetupPayoutAccountProps {
	payoutAccount: PayoutAccount | null | undefined;
	// onSuccess is called via page refresh when user returns from Stripe onboarding
	onSuccess: () => void;
}

export function SetupPayoutAccount({
	payoutAccount,
	onSuccess: _onSuccess,
}: SetupPayoutAccountProps) {
	const [isExecuting, setIsExecuting] = useState(false);

	const handleSetup = async () => {
		setIsExecuting(true);
		try {
			const result = await setupPayoutAccount();
			if (result.success && result.data?.url) {
				window.location.href = result.data.url;
			} else if (result.error) {
				toast.error(result.error || "Failed to start setup");
			}
		} catch (_error) {
			toast.error("An unexpected error occurred");
		} finally {
			setIsExecuting(false);
		}
	};

	if (payoutAccount?.verificationStatus === "verified") {
		return (
			<Button variant="outline" disabled>
				Account Verified
			</Button>
		);
	}

	const isPending =
		payoutAccount?.verificationStatus === "pending" &&
		payoutAccount?.stripeRecipientId;

	return (
		<Button onClick={handleSetup} disabled={isExecuting}>
			{isExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
			{isPending ? "Complete Setup" : "Setup Payout Account"}
		</Button>
	);
}
