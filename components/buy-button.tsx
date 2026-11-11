"use client";

import { IconLock } from "@tabler/icons-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createCheckoutSession } from "@/app/actions/stripe";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function BuyButton({
	planId,
	price,
	currency = "usd",
	label,
	productName,
	disabled,
	fullWidth = true,
}: {
	planId: string;
	price: number;
	currency?: string;
	label?: string;
	productName?: string;
	disabled?: boolean;
	fullWidth?: boolean;
}) {
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);

	const formattedPrice = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(price / 100);

	const triggerLabel = label || `Buy for ${formattedPrice}`;

	function onConfirm() {
		startTransition(async () => {
			const result = await createCheckoutSession(planId);
			// A successful checkout redirects; only failures return a value.
			if (result && "error" in result) {
				toast.error(result.error);
				setOpen(false);
			}
		});
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					className={cn(fullWidth ? "w-full" : "w-auto")}
					size="lg"
					disabled={disabled}
				>
					{triggerLabel}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[400px]">
				<DialogHeader>
					<DialogTitle>Confirm Purchase</DialogTitle>
					<DialogDescription>
						You are about to purchase{" "}
						<span className="font-semibold text-foreground">
							{productName || "this plan"}
						</span>
						.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-6 py-4">
					<div className="flex items-center justify-between rounded-lg bg-muted p-4">
						<span className="text-sm font-medium">Total Amount</span>
						<span className="text-2xl font-bold">{formattedPrice}</span>
					</div>

					<div className="flex items-start gap-3 rounded-md border p-3 text-xs text-muted-foreground">
						<IconLock className="mt-0.5 size-4 shrink-0 text-primary" />
						<p>
							Payment is processed by Stripe on the creator&apos;s own account.
							We do not store or process your card details.
						</p>
					</div>
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button
						className="min-w-[120px]"
						onClick={onConfirm}
						disabled={isPending}
					>
						{isPending ? "Redirecting..." : "Pay Now"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
