"use client";

import { Button } from "@/components/ui/button";
import { setupPayoutAccount } from "@/app/actions/payouts";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface SetupPayoutAccountProps {
	payoutAccount: any;
	onSuccess: () => void;
}

export function SetupPayoutAccount({
	payoutAccount,
	onSuccess,
}: SetupPayoutAccountProps) {
	const router = useRouter();
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
		} catch (error) {
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
