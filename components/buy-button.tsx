"use client";

import { IconLock } from "@tabler/icons-react";
import { useState, useTransition } from "react";
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
	productId,
	price,
	currency = "usd",
	label,
	productName,
	disabled,
	fullWidth = true,
}: {
	productId: string;
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
							{productName || "this pack"}
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
							Payments are processed securely by{" "}
							<span className="font-medium text-foreground">Stripe</span>. Your
							payment information is never stored on our servers.
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
						onClick={() =>
							startTransition(async () => {
								await createCheckoutSession(productId);
							})
						}
						disabled={isPending}
					>
						{isPending ? "Redirecting..." : "Pay Now"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
