"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getPlanDetails } from "@/app/actions/plans";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import { useUpdatePlan } from "@/hooks/use-plans";
import { CURRENCIES } from "@/lib/constants";

/**
 * Edit service identity and the draft commercial terms. Published terms are
 * immutable; replacing them becomes a new version in a later slice.
 */
export function EditPlanDialog({
	planId,
	open,
	onOpenChange,
}: {
	planId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data: details, isLoading } = useQuery({
		queryKey: ["plan-details", planId, "edit"],
		queryFn: async () => {
			const res = await getPlanDetails(planId);
			if (res.success) return res.data;
			throw new Error(res.error as string);
		},
		enabled: open,
	});
	const { mutateAsync, isPending } = useUpdatePlan();
	const [billingMode, setBillingMode] = useState<"one_time" | "recurring">(
		"one_time",
	);

	const plan = details?.plan;
	const draft = plan?.versions?.find((version) => version.status === "draft");
	const published = plan?.versions?.find(
		(version) => version.status === "published",
	);
	const terms = draft ?? published;

	useEffect(() => {
		if (terms) setBillingMode(terms.billingMode);
	}, [terms]);

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const termsChanged = formData.get("termsChanged") === "1";

		mutateAsync({
			id: planId,
			name: formData.get("name") as string,
			description: (formData.get("description") as string) || null,
			...(termsChanged
				? {
						terms: {
							billingMode,
							currency: (formData.get("currency") as "usd" | "eur") || "usd",
							price: Number(formData.get("price")),
							credits: Number(formData.get("credits")),
							interval: billingMode === "recurring" ? ("month" as const) : null,
						},
					}
				: {}),
		})
			.then(() => onOpenChange(false))
			.catch(() => undefined);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[460px]">
				<DialogHeader>
					<DialogTitle>Edit Plan</DialogTitle>
					<DialogDescription>
						Service details are always editable. Commercial terms stay frozen
						once published.
					</DialogDescription>
				</DialogHeader>
				{isLoading || !plan ? (
					<div className="flex justify-center p-8">
						<Loader2 className="h-5 w-5 animate-spin" />
					</div>
				) : (
					<form onSubmit={onSubmit}>
						<div className="grid gap-4 py-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-name">Name</Label>
								<Input
									id="edit-name"
									name="name"
									defaultValue={plan.name}
									required
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-description">Description</Label>
								<Textarea
									id="edit-description"
									name="description"
									defaultValue={plan.description ?? ""}
								/>
							</div>
							{published && !draft ? (
								<p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
									These terms are published. Customers keep them; publishing new
									terms arrives with Stripe setup.
								</p>
							) : (
								<>
									<input type="hidden" name="termsChanged" value="1" />
									<div className="grid gap-2">
										<Label htmlFor="edit-billing-mode">Billing</Label>
										<Select
											value={billingMode}
											onValueChange={(value) =>
												setBillingMode(value as "one_time" | "recurring")
											}
										>
											<SelectTrigger id="edit-billing-mode">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="one_time">One-time pack</SelectItem>
												<SelectItem value="recurring">Monthly plan</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<div className="grid grid-cols-2 gap-4">
										<div className="grid gap-2">
											<Label htmlFor="edit-currency">Currency</Label>
											<Select
												name="currency"
												defaultValue={terms?.currency ?? "usd"}
											>
												<SelectTrigger>
													<SelectValue />
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
											<Label htmlFor="edit-price">
												Price{billingMode === "recurring" ? " / month" : ""}
											</Label>
											<Input
												id="edit-price"
												name="price"
												type="number"
												min="0.01"
												step="0.01"
												defaultValue={
													terms ? (terms.price / 100).toFixed(2) : ""
												}
												required
											/>
										</div>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="edit-credits">Credits</Label>
										<Input
											id="edit-credits"
											name="credits"
											type="number"
											min="1"
											step="1"
											defaultValue={terms?.credits ?? 1}
											required
										/>
									</div>
								</>
							)}
						</div>
						<DialogFooter>
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
								Save
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
