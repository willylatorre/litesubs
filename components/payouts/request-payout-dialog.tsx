"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { requestPayout } from "@/app/actions/payouts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface RequestPayoutDialogProps {
	availableBalance: number;
	minimumPayout: number;
	platformFeePercent: number;
	onSuccess: () => void;
	disabled?: boolean;
}

export function RequestPayoutDialog({
	availableBalance,
	minimumPayout,
	platformFeePercent,
	onSuccess,
	disabled,
}: RequestPayoutDialogProps) {
	const [open, setOpen] = useState(false);
	const [amount, setAmount] = useState(availableBalance.toString());
	const [confirmed, setConfirmed] = useState(false);
	const [isExecuting, setIsExecuting] = useState(false);
	const amountId = useId();
	const confirmId = useId();

	const handleRequest = async () => {
		const val = parseFloat(amount);
		if (Number.isNaN(val) || val < minimumPayout || val > availableBalance) {
			toast.error("Invalid amount");
			return;
		}

		setIsExecuting(true);
		try {
			const result = await requestPayout({ amount: val });
			if (result.success) {
				toast.success(
					"Payout request submitted! Funds will arrive in 5-7 business days.",
				);
				setOpen(false);
				onSuccess();
			} else {
				toast.error(result.error || "Failed to request payout");
			}
		} catch (_error) {
			toast.error("An unexpected error occurred");
		} finally {
			setIsExecuting(false);
		}
	};

	const parsedAmount = parseFloat(amount) || 0;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button disabled={disabled}>Request Payout</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Request Payout</DialogTitle>
					<DialogDescription>
						Transfer your earnings to your bank account.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-4">
					<div className="grid grid-cols-4 items-center gap-4">
						<Label htmlFor={amountId} className="text-right">
							Amount
						</Label>
						<Input
							id={amountId}
							type="number"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
							className="col-span-3"
							max={availableBalance}
							min={minimumPayout}
							step="0.01"
						/>
					</div>
					<div className="space-y-2 text-sm text-muted-foreground bg-muted p-4 rounded-md">
						<div className="flex justify-between">
							<span>Request Amount:</span>
							<span>${parsedAmount.toFixed(2)}</span>
						</div>
						<div className="flex justify-between">
							<span>Platform Fee ({platformFeePercent}%):</span>
							<span>Already deducted</span>
						</div>
						<div className="flex justify-between font-bold pt-2 border-t">
							<span>You will receive:</span>
							<span>${parsedAmount.toFixed(2)}</span>
						</div>
						<div className="flex justify-between pt-2">
							<span>Method:</span>
							<span>Connected Bank Account</span>
						</div>
					</div>

					<div className="flex items-center space-x-2">
						<Checkbox
							id={confirmId}
							checked={confirmed}
							onCheckedChange={(c) => setConfirmed(!!c)}
						/>
						<Label htmlFor={confirmId} className="text-sm font-normal">
							I confirm the bank account details are correct
						</Label>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleRequest}
						disabled={
							!confirmed ||
							isExecuting ||
							parsedAmount < minimumPayout ||
							parsedAmount > availableBalance
						}
					>
						{isExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Request Payout
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
