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
	billingMode = "one_time",
	credits,
	disabled,
	fullWidth = true,
}: {
	planId: string;
	price: number;
	currency?: string;
	label?: string;
	productName?: string;
	billingMode?: "one_time" | "recurring";
	credits?: number;
	disabled?: boolean;
	fullWidth?: boolean;
}) {
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);

	const formattedPrice = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(price / 100);

	const recurring = billingMode === "recurring";
	const displayPrice = `${formattedPrice}${recurring ? " / month" : ""}`;
	const triggerLabel =
		label || `${recurring ? "Subscribe for" : "Buy for"} ${displayPrice}`;

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
					<DialogTitle>
						{recurring ? "Confirm monthly subscription" : "Confirm purchase"}
					</DialogTitle>
					<DialogDescription>
						You are about to {recurring ? "subscribe to" : "purchase"}{" "}
						<span className="font-semibold text-foreground">
							{productName || "this plan"}
						</span>
						.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-6 py-4">
					<div className="flex items-center justify-between rounded-lg bg-muted p-4">
						<span className="text-sm font-medium">
							{recurring ? "Monthly amount" : "Total amount"}
						</span>
						<span className="text-2xl font-bold">{displayPrice}</span>
					</div>
					{recurring && (
						<div className="rounded-md border p-3 text-sm">
							<p className="font-medium">
								{credits ?? "This plan"}{" "}
								{typeof credits === "number" ? "credits" : ""} each paid month
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Renews monthly. Unused credits do not roll over and expire at
								the end of the paid month.
							</p>
						</div>
					)}

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
						{isPending ? "Redirecting..." : recurring ? "Subscribe" : "Pay Now"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
