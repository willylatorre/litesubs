"use client";

import { Button } from "@/components/ui/button";
import { useAction } from "next-safe-action/hooks";
import { setupPayoutAccount } from "@/app/actions/payouts";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface SetupPayoutAccountProps {
	payoutAccount: any;
	onSuccess: () => void;
}

export function SetupPayoutAccount({
	payoutAccount,
	onSuccess,
}: SetupPayoutAccountProps) {
	const router = useRouter();
	const { execute, isExecuting } = useAction(setupPayoutAccount, {
		onSuccess: (result) => {
			if (result.data?.url) {
				window.location.href = result.data.url;
			}
		},
		onError: (error) => {
			toast.error(error.error.serverError || "Failed to start setup");
		},
	});

	if (payoutAccount?.verificationStatus === "verified") {
		return (
			<Button variant="outline" disabled>
				Account Verified
			</Button>
		);
	}
	
	const isPending = payoutAccount?.verificationStatus === 'pending' && payoutAccount?.stripeRecipientId;

	return (
		<Button onClick={() => execute({})} disabled={isExecuting}>
			{isExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
			{isPending ? "Complete Setup" : "Setup Payout Account"}
		</Button>
	);
}
