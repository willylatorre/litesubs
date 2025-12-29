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
import { useCreateProduct } from "@/hooks/use-products";
import { CURRENCIES } from "@/lib/constants";

export interface DemoPackData {
	name: string;
	description: string;
	price: number;
	credits: number;
	currency: string;
}

interface CreatePackDialogProps {
	onDemoCreate?: (data: DemoPackData) => void;
}

export function CreatePackDialog({ onDemoCreate }: CreatePackDialogProps) {
	const [open, setOpen] = useState(false);
	const [demoPending, setDemoPending] = useState(false);
	const { mutate, isPending: isMutatePending } = useCreateProduct();

	const isPending = onDemoCreate ? demoPending : isMutatePending;

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		
		const data = {
			name: formData.get("name") as string,
			description: formData.get("description") as string,
			price: Number(formData.get("price")),
			credits: Number(formData.get("credits")),
			currency: (formData.get("currency") as any) || "usd",
		};

		if (onDemoCreate) {
			setDemoPending(true);
			setTimeout(() => {
				onDemoCreate(data);
				setDemoPending(false);
				setOpen(false);
			}, 600);
			return;
		}

		mutate(
			data,
			{
				onSuccess: () => setOpen(false),
			},
		);
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size={onDemoCreate ? "lg" : "default"}>
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
								defaultValue={onDemoCreate ? "Starter Pack" : undefined}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								name="description"
								placeholder="Optional description..."
								defaultValue={onDemoCreate ? "Get 100 credits for your next project." : undefined}
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
									defaultValue={onDemoCreate ? "10" : undefined}
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
								defaultValue={onDemoCreate ? "100" : undefined}
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
