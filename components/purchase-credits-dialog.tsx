"use client";

import { IconShoppingCart } from "@tabler/icons-react";
import { useState } from "react";
import { BuyButton } from "@/components/buy-button";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

interface Product {
	id: string;
	name: string;
	price: number;
	credits: number;
	description?: string | null;
	currency?: "usd" | "eur";
}

export function PurchaseCreditsDialog({
	creatorName,
	packs,
}: {
	creatorName: string;
	packs: Product[];
}) {
	const [open, setOpen] = useState(false);

	if (packs.length === 0) {
		return (
			<Button disabled variant="outline" className="w-full">
				No packs available
			</Button>
		);
	}

	if (packs.length === 1) {
		return (
			<BuyButton
				productId={packs[0].id}
				price={packs[0].price}
				currency={packs[0].currency}
				label="Purchase credits"
			/>
		);
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button className="w-full">Purchase credits</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Top up credits</DialogTitle>
					<DialogDescription>
						Buy more credits from {creatorName}.
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
									currency={pack.currency}
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
