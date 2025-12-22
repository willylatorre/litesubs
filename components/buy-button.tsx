"use client";

import { useTransition } from "react";
import { createCheckoutSession } from "@/app/actions/stripe";
import { Button } from "@/components/ui/button";

export function BuyButton({
	productId,
	price,
	currency = "usd",
}: {
	productId: string;
	price: number;
	currency?: string;
}) {
	const [isPending, startTransition] = useTransition();

	const formattedPrice = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(price / 100);

	return (
		<Button
			className="w-full"
			size="lg"
			onClick={() =>
				startTransition(async () => {
					await createCheckoutSession(productId);
				})
			}
			disabled={isPending}
		>
			{isPending ? "Processing..." : `Proceed to Payment (${formattedPrice})`}
		</Button>
	);
}
