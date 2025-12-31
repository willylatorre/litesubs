"use client";

import { useState } from "react";
import { Link, Loader2, Check, Copy } from "lucide-react";
import { createPaymentLink } from "@/app/actions/stripe";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

interface PaymentLinkButtonProps {
	customerId: string;
	productId: string;
	size?: "sm" | "default" | "lg" | "icon";
}

export function PaymentLinkButton({
	customerId,
	productId,
	size = "sm",
}: PaymentLinkButtonProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [open, setOpen] = useState(false);

	const handleGenerateLink = async () => {
		setIsLoading(true);
		try {
			const result = await createPaymentLink(customerId, productId);
			if (result.success && result.url) {
				setPaymentUrl(result.url);
			} else {
				toast.error(result.error || "Failed to generate payment link");
				setOpen(false);
			}
		} catch {
			toast.error("Failed to generate payment link");
			setOpen(false);
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

	const handleOpenChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (!isOpen) {
			// Reset state when closing
			setPaymentUrl(null);
			setCopied(false);
		}
	};

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					size={size}
					className="h-7 w-7 p-0"
					title="Generate payment link"
				>
					<Link className="h-3.5 w-3.5" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80" align="end">
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<h4 className="text-sm font-medium">Payment Link</h4>
						<p className="text-xs text-muted-foreground">
							Generate a payment link for this customer to purchase credits.
						</p>
					</div>

					{!paymentUrl ? (
						<Button
							onClick={handleGenerateLink}
							disabled={isLoading}
							size="sm"
							className="w-full"
						>
							{isLoading ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Generating...
								</>
							) : (
								<>
									<Link className="mr-2 h-4 w-4" />
									Generate Link
								</>
							)}
						</Button>
					) : (
						<div className="flex flex-col gap-2">
							<div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
								<input
									type="text"
									value={paymentUrl}
									readOnly
									className="flex-1 bg-transparent text-xs font-mono truncate outline-none"
								/>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 shrink-0"
									onClick={handleCopy}
								>
									{copied ? (
										<Check className="h-3.5 w-3.5 text-green-600" />
									) : (
										<Copy className="h-3.5 w-3.5" />
									)}
								</Button>
							</div>
							<p className="text-[10px] text-muted-foreground">
								Share this link with the customer to complete their purchase.
							</p>
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
