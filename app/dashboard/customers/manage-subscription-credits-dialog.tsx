"use client";

import { IconPlus } from "@tabler/icons-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSubscriptionCredits } from "@/app/actions/customers";
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
import { cn } from "@/lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export function ManageSubscriptionCreditsDialog({
	subscriptionId,
	planName,
	currentCredits,
	onSuccess,
	compact = false,
}: {
	subscriptionId: string;
	planName: string;
	currentCredits: number;
	onSuccess?: () => void;
	compact?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [amount, setAmount] = useState("");
	const [description, setDescription] = useState("");
	const [isPending, startTransition] = useTransition();
	const amountId = useId();
	const descriptionId = useId();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const val = Number.parseInt(amount, 10);
		if (Number.isNaN(val) || val === 0) {
			toast.error("Please enter a valid non-zero amount");
			return;
		}

		startTransition(async () => {
			const res = await updateSubscriptionCredits(subscriptionId, val, description);
			if (res.success) {
				toast.success("Credits updated");
				setOpen(false);
				setAmount("");
				setDescription("");
				onSuccess?.();
			} else {
				toast.error(res.error as string);
			}
		});
	};

	const previewCredits = amount ? currentCredits + Number.parseInt(amount, 10) || currentCredits : currentCredits;

	const trigger = compact ? (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="ghost" size="icon" className="h-8 w-8">
						<IconPlus className="h-3.5 w-3.5" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>Adjust credits</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	) : (
		<Button variant="ghost" size="sm" className="gap-1.5 text-xs">
			<IconPlus className="h-3.5 w-3.5" />
			Adjust
		</Button>
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle className="text-lg font-bold">Adjust Credits</DialogTitle>
						<DialogDescription className="text-sm">
							{planName}
						</DialogDescription>
					</DialogHeader>
					
					<div className="py-6">
						{/* Credits Preview */}
						<div className="flex items-center justify-center gap-4 mb-6">
							<div className="text-center">
								<p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Current</p>
								<p className="text-2xl font-bold tabular-nums">{currentCredits}</p>
							</div>
							<div className="text-muted-foreground">→</div>
							<div className="text-center">
								<p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">After</p>
								<p className={cn(
									"text-2xl font-bold tabular-nums",
									previewCredits !== currentCredits && (previewCredits > currentCredits ? "text-green-600" : "text-red-600")
								)}>
									{previewCredits}
								</p>
							</div>
						</div>
						
						{/* Quick Actions */}
						<div className="flex items-center justify-center gap-2 mb-6">
							{[-10, -5, -1].map((val) => (
								<Button
									key={val}
									type="button"
									variant="outline"
									size="sm"
									className="h-9 w-12 text-xs font-medium"
									onClick={() => setAmount(String(val))}
								>
									{val}
								</Button>
							))}
							<div className="w-px h-6 bg-border mx-1" />
							{[1, 5, 10].map((val) => (
								<Button
									key={val}
									type="button"
									variant="outline"
									size="sm"
									className="h-9 w-12 text-xs font-medium"
									onClick={() => setAmount(String(val))}
								>
									+{val}
								</Button>
							))}
						</div>
						
						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor={amountId} className="text-xs font-medium">
									Custom amount
								</Label>
								<Input
									id={amountId}
									type="number"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									placeholder="e.g. 50 or -20"
									className="h-9 text-sm"
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor={descriptionId} className="text-xs font-medium">
									Reason <span className="text-muted-foreground">(optional)</span>
								</Label>
								<Input
									id={descriptionId}
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="e.g. Refund, Bonus, Session used"
									className="h-9 text-sm"
								/>
							</div>
						</div>
					</div>
					
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setOpen(false)}
							className="text-sm"
						>
							Cancel
						</Button>
						<Button
							type="submit" 
							disabled={isPending || !amount || Number.parseInt(amount, 10) === 0}
							className="text-sm"
						>
							{isPending ? "Saving..." : "Apply Changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
