"use client";

import { IconMinus } from "@tabler/icons-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { updateEnrollmentCredits } from "@/app/actions/customers";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function DecreaseCreditButton({
	enrollmentId,
	currentCredits,
	variant = "ghost",
	size = "sm",
	className,
	onSuccess,
	showLabel = true,
}: {
	enrollmentId: string;
	currentCredits: number;
	variant?:
		| "outline"
		| "ghost"
		| "default"
		| "secondary"
		| "destructive"
		| "link";
	size?: "default" | "sm" | "lg" | "icon";
	className?: string;
	onSuccess?: () => void;
	showLabel?: boolean;
}) {
	const [isPending, startTransition] = useTransition();

	const handleDecrease = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (currentCredits <= 0) {
			toast.error("Cannot decrease credits below 0");
			return;
		}

		startTransition(async () => {
			const res = await updateEnrollmentCredits(
				enrollmentId,
				-1,
				"Quick decrement",
			);
			if (res.success) {
				toast.success("Decreased 1 credit");
				onSuccess?.();
			} else {
				toast.error(res.error as string);
			}
		});
	};

	const button = (
		<Button
			variant={variant}
			size={showLabel ? size : "icon"}
			onClick={handleDecrease}
			disabled={isPending || currentCredits <= 0}
			className={cn(
				"transition-all duration-200",
				showLabel ? "gap-1.5" : "h-8 w-8",
				className,
			)}
		>
			{isPending ? (
				<Spinner className="h-3.5 w-3.5" />
			) : (
				<>
					<IconMinus className="h-3.5 w-3.5" />
					{showLabel && <span className="text-xs">1</span>}
				</>
			)}
		</Button>
	);

	if (!showLabel) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>{button}</TooltipTrigger>
					<TooltipContent>
						<p>Decrease 1 credit</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}

	return button;
}
