"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { openCustomerBillingPortal } from "@/app/actions/subscriptions";
import { Button } from "@/components/ui/button";

export function ManageBillingButton({
	subscriptionId,
	label = "Manage billing",
	size = "sm",
}: {
	subscriptionId: string;
	label?: string;
	size?: "default" | "sm" | "lg" | "icon";
}) {
	const [isPending, startTransition] = useTransition();

	function openPortal() {
		startTransition(async () => {
			const result = await openCustomerBillingPortal(subscriptionId);
			if (result && "error" in result) toast.error(result.error);
		});
	}

	return (
		<Button
			variant="outline"
			size={size}
			disabled={isPending}
			onClick={openPortal}
		>
			{isPending ? "Opening…" : label}
		</Button>
	);
}
