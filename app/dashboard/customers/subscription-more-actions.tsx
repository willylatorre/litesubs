"use client";

import { useState } from "react";
import { Link, Loader2, MoreHorizontal, Check, Copy } from "lucide-react";
import { createPaymentLink } from "@/app/actions/stripe";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface SubscriptionMoreActionsProps {
	customerId: string;
	productId: string;
}

export function SubscriptionMoreActions({
	customerId,
	productId,
}: SubscriptionMoreActionsProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleGenerateLink = async () => {
		setIsLoading(true);
		try {
			const result = await createPaymentLink(customerId, productId);
			if (result.success && result.url) {
				setPaymentUrl(result.url);
				setDialogOpen(true);
			} else {
				toast.error(result.error || "Failed to generate payment link");
			}
		} catch {
			toast.error("Failed to generate payment link");
		} finally {
			setIsLoading(false);
		}
	};

	const handleCopy = async () => {
		if (!paymentUrl) return;
		try {
			await navigator.clipboard.writeText(paymentUrl);
			setCopied(true);
			toast.success("Payment link copied to clipboard");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error("Failed to copy link");
		}
	};

	const handleDialogClose = () => {
		setDialogOpen(false);
		setPaymentUrl(null);
		setCopied(false);
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0"
						disabled={isLoading}
					>
						{isLoading ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<MoreHorizontal className="h-3.5 w-3.5" />
						)}
						<span className="sr-only">More actions</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={handleGenerateLink} disabled={isLoading}>
						<Link className="h-4 w-4" />
						Generate payment link
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Payment Link Generated</DialogTitle>
						<DialogDescription>
							Share this link with the customer to complete their purchase.
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-2 rounded-md border bg-muted/50 p-3">
						<input
							type="text"
							value={paymentUrl || ""}
							readOnly
							className="flex-1 bg-transparent text-sm font-mono truncate outline-none"
						/>
						<Button
							variant="outline"
							size="sm"
							className="shrink-0"
							onClick={handleCopy}
						>
							{copied ? (
								<>
									<Check className="h-4 w-4 text-green-600" />
									Copied
								</>
							) : (
								<>
									<Copy className="h-4 w-4" />
									Copy
								</>
							)}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
