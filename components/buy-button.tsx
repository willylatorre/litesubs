"use client";

import { useState, useTransition } from "react";
import { createCheckoutSession } from "@/app/actions/stripe";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

interface Pack {
	id: string;
	name: string;
	price: number;
	credits: number;
	currency?: string;
}

export function BuyButton({
	productId,
	price,
	currency = "usd",
	label,
	packs,
	creatorName,
}: {
	productId?: string;
	price?: number;
	currency?: string;
	label?: string;
	packs?: Pack[];
	creatorName?: string;
}) {
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);

	// Case 1: Multiple packs - show Dialog
	if (packs && packs.length > 1) {
		return (
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>
					<Button className="w-full" size="lg">
						{label || "Purchase credits"}
					</Button>
				</DialogTrigger>
				<DialogContent className="sm:max-w-[425px]">
					<DialogHeader>
						<DialogTitle>Top up credits</DialogTitle>
						<DialogDescription>
							Buy more credits from {creatorName || "this creator"}.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						{packs.map((pack) => (
							<div
								key={pack.id}
								className="flex items-center justify-between rounded-lg border p-4"
							>
								<div className="flex flex-col gap-1">
									<span className="font-semibold">{pack.name}</span>
									<span className="text-sm text-muted-foreground">
										{pack.credits} credits
									</span>
								</div>
								<div className="w-[140px]">
									<BuyButton
										productId={pack.id}
										price={pack.price}
										currency={pack.currency || currency}
										label="Buy"
									/>
								</div>
							</div>
						))}
					</div>
				</DialogContent>
			</Dialog>
		);
	}

	// Case 2: Single pack in array or explicit productId
	const finalId = packs?.[0]?.id || productId;
	const finalPrice = packs?.[0]?.price || price;
	const finalCurrency = packs?.[0]?.currency || currency;

	if (!finalId || finalPrice === undefined) {
		return null;
	}

	const formattedPrice = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: finalCurrency.toUpperCase(),
	}).format(finalPrice / 100);

	const buttonText = label
		? `${label} (${formattedPrice})`
		: `Proceed to Payment (${formattedPrice})`;

	return (
		<Button
			className="w-full"
			size="lg"
			onClick={() =>
				startTransition(async () => {
					await createCheckoutSession(finalId);
				})
			}
			disabled={isPending}
		>
			{isPending ? "Processing..." : buttonText}
		</Button>
	);
}