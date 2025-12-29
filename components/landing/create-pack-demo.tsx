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

export interface DemoPackData {
	name: string;
	description: string;
	price: number;
	credits: number;
	currency: string;
}

interface CreatePackDemoProps {
	onCreate: (data: DemoPackData) => void;
}

const CURRENCIES = ["usd", "eur", "gbp"];

export function CreatePackDemo({ onCreate }: CreatePackDemoProps) {
	const [open, setOpen] = useState(false);
	const [isPending, setIsPending] = useState(false);

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		setIsPending(true);

		// Simulate network delay
		setTimeout(() => {
			onCreate({
				name: formData.get("name") as string,
				description: formData.get("description") as string,
				price: Number(formData.get("price")),
				credits: Number(formData.get("credits")),
				currency: (formData.get("currency") as any) || "usd",
			});
			setIsPending(false);
			setOpen(false);
		}, 600);
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="lg">
					<Plus className="mr-2 h-4 w-4" />
					Create Pack
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[425px]">
				<form onSubmit={onSubmit}>
					<DialogHeader>
						<DialogTitle>Create Pack</DialogTitle>
						<DialogDescription>
							Create a new credit pack for your customers.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="name">Name</Label>
							<Input
								id="name"
								name="name"
								placeholder="e.g. Starter Pack"
								required
								defaultValue="Starter Pack"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								name="description"
								placeholder="Optional description..."
								defaultValue="Get 100 credits for your next project."
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="currency">Currency</Label>
								<Select name="currency" defaultValue="usd">
									<SelectTrigger>
										<SelectValue placeholder="Select currency" />
									</SelectTrigger>
									<SelectContent>
										{CURRENCIES.map((currency) => (
											<SelectItem key={currency} value={currency}>
												{currency.toUpperCase()}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="price">Price</Label>
								<Input
									id="price"
									name="price"
									type="number"
									min="0"
									step="0.01"
									placeholder="10.00"
									required
									defaultValue="10"
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="credits">Credits</Label>
							<Input
								id="credits"
								name="credits"
								type="number"
								min="1"
								step="1"
								placeholder="100"
								required
								defaultValue="100"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={isPending}>
							{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							Create Pack
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
