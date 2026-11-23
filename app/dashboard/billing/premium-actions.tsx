"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
	managePremiumBillingAction,
	startPremiumCheckoutAction,
} from "@/app/actions/billing";
import { Button } from "@/components/ui/button";

/**
 * Premium's two money buttons. Both return a Stripe-hosted URL rather than
 * redirecting inside the action, so a Stripe failure can be reported as a toast
 * instead of surfacing as a navigation error.
 */
export function PremiumActions({
	isPremium,
	configured,
}: {
	isPremium: boolean;
	configured: boolean;
}) {
	const [pending, startTransition] = useTransition();

	function run(action: typeof startPremiumCheckoutAction, fallback: string) {
		startTransition(async () => {
			const result = await action();
			if (result.success && result.data?.url) {
				window.location.href = result.data.url;
				return;
			}
			toast.error(result.error ?? fallback);
		});
	}

	if (isPremium) {
		return (
			<Button
				variant="outline"
				disabled={pending}
				onClick={() =>
					run(managePremiumBillingAction, "Could not open billing")
				}
			>
				{pending ? "Opening…" : "Manage subscription"}
			</Button>
		);
	}

	return (
		<Button
			disabled={pending || !configured}
			onClick={() =>
				run(startPremiumCheckoutAction, "Could not start checkout")
			}
		>
			{pending ? "Starting…" : "Upgrade to Premium"}
		</Button>
	);
}
