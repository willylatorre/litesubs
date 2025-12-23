"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSubscriptionCredits } from "@/app/actions/customers";
import { Button } from "@/components/ui/button";
import { IconMinus } from "@tabler/icons-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function DecreaseCreditButton({
	subscriptionId,
	currentCredits,
	variant = "outline",
	size = "sm",
	className,
	onSuccess,
}: {
	subscriptionId: string;
	currentCredits: number;
	variant?: "outline" | "ghost" | "default" | "secondary" | "destructive" | "link";
	size?: "default" | "sm" | "lg" | "icon";
	className?: string;
	onSuccess?: () => void;
}) {
	const [isPending, startTransition] = useTransition();

	const handleDecrease = (e: React.MouseEvent) => {
		e.stopPropagation(); // Prevent row click or parent click
		if (currentCredits <= 0) {
			toast.error("Cannot decrease credits below 0");
			return;
		}

		startTransition(async () => {
			const res = await updateSubscriptionCredits(
				subscriptionId,
				-1,
				"Quick decrement"
			);
			if (res.success) {
				toast.success("Decreased 1 credit");
				onSuccess?.();
			} else {
				toast.error(res.error as string);
			}
		});
	};

	return (
		<Button
			variant={variant}
			size={size}
			onClick={handleDecrease}
			disabled={isPending || currentCredits <= 0}
			className={cn("whitespace-nowrap", className)}
			title="Decrease 1 Credit"
		>
			{isPending ? (
				<Spinner className="h-4 w-4" />
			) : (
				<>
					<IconMinus className="h-4 w-4 mr-1" />1 Credit
				</>
			)}
		</Button>
	);
}
