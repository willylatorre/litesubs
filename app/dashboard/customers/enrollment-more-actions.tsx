"use client";

import { Link2, Loader2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createCustomerCheckout } from "@/app/actions/stripe";
import { ShareLinkActions } from "@/components/share-link-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface EnrollmentMoreActionsProps {
	customerEmail: string;
	planId: string;
}

/**
 * Ask one customer to pay for one plan. Stripe returns a single-use Checkout
 * session instead of a reusable link that embeds someone's identity.
 */
export function EnrollmentMoreActions({
	customerEmail,
	planId,
}: EnrollmentMoreActionsProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);

	async function handleGenerate() {
		setIsLoading(true);
		try {
			const result = await createCustomerCheckout(planId, customerEmail);
			if (result.success && result.url) {
				setCheckoutUrl(result.url);
				setDialogOpen(true);
			} else {
				toast.error(result.error || "Failed to create checkout");
			}
		} catch {
			toast.error("Failed to create checkout");
		} finally {
			setIsLoading(false);
		}
	}

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
					<DropdownMenuItem onClick={handleGenerate} disabled={isLoading}>
						<Link2 className="h-4 w-4" />
						Create checkout link
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Checkout Link Created</DialogTitle>
						<DialogDescription>
							Send this single-use link to {customerEmail}. Credits are granted
							only after Stripe confirms payment.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-3">
						<div className="rounded-md border bg-muted/50 p-3">
							<input
								type="text"
								value={checkoutUrl || ""}
								readOnly
								aria-label="Checkout link"
								className="w-full bg-transparent text-sm font-mono truncate outline-none"
							/>
						</div>
						{/* A Stripe URL, not an app URL: share it exactly as issued. */}
						{checkoutUrl && (
							<ShareLinkActions
								url={checkoutUrl}
								title="Complete your purchase"
								text={`Checkout for ${customerEmail}`}
							/>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
