"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
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
import { useCalEventTypes, useUpdatePlanCalEventType } from "@/hooks/use-cal";
import { useCreatePlan } from "@/hooks/use-plans";
import { CURRENCIES } from "@/lib/constants";

/** Create a local draft plan. Nothing here contacts Stripe. */
export function CreatePlanDialog() {
	const [open, setOpen] = useState(false);
	const [billingMode, setBillingMode] = useState<"one_time" | "recurring">(
		"one_time",
	);
	const { mutateAsync, isPending } = useCreatePlan();
	const { mutateAsync: updateEventType } = useUpdatePlanCalEventType();
	const { data: calEventTypesData, isLoading: calLoading } = useCalEventTypes();
	const [selectedEventTypeId, setSelectedEventTypeId] = useState("none");

	const selectedEventType =
		calEventTypesData?.eventTypes.find(
			(eventType) => String(eventType.id) === selectedEventTypeId,
		) ?? null;

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);

		const data = {
			name: formData.get("name") as string,
			description: (formData.get("description") as string) || undefined,
			terms: {
				billingMode,
				currency: (formData.get("currency") as "usd" | "eur") || "usd",
				price: Number(formData.get("price")),
				credits: Number(formData.get("credits")),
				interval: billingMode === "recurring" ? ("month" as const) : null,
			},
		};

		mutateAsync(data)
			.then(async (createdPlan) => {
				if (selectedEventType && createdPlan?.id) {
					await updateEventType({
						planId: createdPlan.id,
						eventType: selectedEventType,
					});
				}
				setOpen(false);
			})
			.catch(() => undefined);
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button>
					<Plus className="mr-2 h-4 w-4" />
					Create Plan
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[460px]">
				<form onSubmit={onSubmit}>
					<DialogHeader>
						<DialogTitle>Create Draft Plan</DialogTitle>
						<DialogDescription>
							Drafts are visible here only. Publishing needs a Stripe account,
							so nothing is purchasable until then.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
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
								<SelectTrigger id="billing-mode">
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
						<div className="grid gap-2">
							<Label htmlFor="cal-event-type">Cal.com event type</Label>
							<Select
								value={selectedEventTypeId}
								onValueChange={setSelectedEventTypeId}
								disabled={!calEventTypesData?.connected || calLoading}
							>
								<SelectTrigger id="cal-event-type">
									<SelectValue
										placeholder={
											calLoading
												? "Loading event types..."
												: "Select an event type (optional)"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No event type</SelectItem>
									{calEventTypesData?.eventTypes.map((eventType) => (
										<SelectItem key={eventType.id} value={String(eventType.id)}>
											{eventType.name || eventType.slug}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{!calEventTypesData?.connected && !calLoading && (
								<p className="text-xs text-muted-foreground">
									Connect Cal.com in{" "}
									<Link
										href="/dashboard/integrations"
										className="underline underline-offset-4"
									>
										Integrations
									</Link>{" "}
									to attach an event type.
								</p>
							)}
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
								<Label htmlFor="price">
									Price{billingMode === "recurring" ? " / month" : ""}
								</Label>
								<Input
									id="price"
									name="price"
									type="number"
									min="0.01"
									step="0.01"
									placeholder="10.00"
									required
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
							/>
						</div>
					</div>
					<DialogFooter>
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
