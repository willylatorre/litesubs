"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreatePlan } from "@/hooks/use-plans";
import { CURRENCIES } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";

type Currency = (typeof CURRENCIES)[number];

/** Create a local draft plan. Nothing here contacts Stripe. */
export function CreatePlanDialog() {
	const [open, setOpen] = useState(false);
	const [billingMode, setBillingMode] = useState<"one_time" | "recurring">(
		"one_time",
	);
	const [currency, setCurrency] = useState<Currency>("usd");
	const [price, setPrice] = useState("");
	const [credits, setCredits] = useState("");
	const { mutateAsync, isPending } = useCreatePlan();

	const priceValue = Number(price);
	const creditsValue = Number(credits);
	const hasOffer =
		Number.isFinite(priceValue) &&
		priceValue > 0 &&
		Number.isInteger(creditsValue) &&
		creditsValue >= 1;

	function resetForm() {
		setBillingMode("one_time");
		setCurrency("usd");
		setPrice("");
		setCredits("");
	}

	function onOpenChange(next: boolean) {
		if (!next) resetForm();
		setOpen(next);
	}

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);

		const data = {
			name: formData.get("name") as string,
			description: (formData.get("description") as string) || undefined,
			terms: {
				billingMode,
				currency,
				price: Number(price),
				credits: Number(credits),
				interval: billingMode === "recurring" ? ("month" as const) : null,
			},
		};

		mutateAsync(data)
			.then(() => {
				resetForm();
				setOpen(false);
			})
			.catch(() => undefined);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button>
					<Plus className="mr-2 h-4 w-4" />
					Create Plan
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[460px] max-h-[85vh] overflow-y-auto">
				<form onSubmit={onSubmit} className="flex flex-col gap-5">
					<DialogHeader>
						<DialogTitle>Create Draft Plan</DialogTitle>
						<DialogDescription>
							Drafts are visible here only. Publishing needs a Stripe account,
							so nothing is purchasable until then.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="name">Name</Label>
							<Input
								id="name"
								name="name"
								placeholder="e.g. Starter Plan"
								required
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								name="description"
								placeholder="Optional description..."
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="billing-mode">Billing</Label>
							<Select
								value={billingMode}
								onValueChange={(value) =>
									setBillingMode(value as "one_time" | "recurring")
								}
							>
								<SelectTrigger id="billing-mode" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="one_time">One-time pack</SelectItem>
									<SelectItem value="recurring">Monthly plan</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{billingMode === "recurring"
									? "Monthly credits renew each paid month and do not roll over."
									: "A one-time pack: the customer buys these credits once."}
							</p>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="currency">Currency</Label>
								<Select
									value={currency}
									onValueChange={(value) => setCurrency(value as Currency)}
								>
									<SelectTrigger id="currency" className="w-full">
										<SelectValue placeholder="Select currency" />
									</SelectTrigger>
									<SelectContent>
										{CURRENCIES.map((option) => (
											<SelectItem key={option} value={option}>
												{option.toUpperCase()}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="price">
									Price{billingMode === "recurring" ? " / month" : ""}
								</Label>
								<Input
									id="price"
									name="price"
									type="number"
									inputMode="decimal"
									min="0.01"
									step="0.01"
									placeholder="10.00"
									value={price}
									onChange={(e) => setPrice(e.target.value)}
									required
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<div className="flex items-baseline justify-between gap-3">
								<Label htmlFor="credits">Credits</Label>
								<span className="text-muted-foreground text-xs">
									Lessons, products, items, etc.
								</span>
							</div>
							<Input
								id="credits"
								name="credits"
								type="number"
								inputMode="numeric"
								min="1"
								step="1"
								placeholder="100"
								value={credits}
								onChange={(e) => setCredits(e.target.value)}
								required
							/>
							<p className="text-muted-foreground min-h-4 text-xs">
								{hasOffer
									? `That works out to ${formatCurrency(
											priceValue / creditsValue,
											currency,
										)} per credit.`
									: "One credit per lesson, product, or item."}
							</p>
						</div>
					</div>

					<div
						className="rounded-md border bg-muted/40 px-3.5 py-3"
						aria-live="polite"
					>
						{hasOffer ? (
							<p className="text-sm">
								Your customer will pay{" "}
								<span className="font-medium">
									{formatCurrency(priceValue, currency)}
								</span>{" "}
								{billingMode === "recurring" ? (
									<span className="text-muted-foreground">per month</span>
								) : null}{" "}
								for{" "}
								<span className="font-medium">
									{creditsValue.toLocaleString("en-US")}{" "}
									{creditsValue === 1 ? "credit" : "credits"}
								</span>
								.
							</p>
						) : (
							<p className="text-muted-foreground text-sm">
								Set a price and a credit count to preview the offer.
							</p>
						)}
					</div>

					<DialogFooter className="border-t pt-4">
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={isPending}>
							{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							Create Draft
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
