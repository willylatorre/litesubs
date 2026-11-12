"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setSubscriptionCancellation } from "@/app/actions/subscriptions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function SubscriptionActions({
	subscriptionId,
	cancelAtPeriodEnd,
	effectiveAt,
	paidThroughAt,
}: {
	subscriptionId: string;
	cancelAtPeriodEnd: boolean;
	effectiveAt: Date | null;
	paidThroughAt: Date | null;
}) {
	const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
	const [isPending, startTransition] = useTransition();
	const effectiveDate = effectiveAt?.toLocaleDateString();
	const paidThroughDate = paidThroughAt?.toLocaleDateString();

	function updateCancellation(cancel: boolean) {
		startTransition(async () => {
			const result = await setSubscriptionCancellation(subscriptionId, cancel);
			if (!result.success) {
				toast.error(result.error || "Could not update this subscription");
				return;
			}
			setCancelDialogOpen(false);
			toast.success(
				cancel
					? `Renewal scheduled to stop${effectiveDate ? ` on ${effectiveDate}` : " at the end of the paid period"}`
					: "Subscription resumed",
			);
		});
	}

	return (
		<>
			{cancelAtPeriodEnd ? (
				<Button
					variant="outline"
					size="sm"
					disabled={isPending}
					onClick={() => updateCancellation(false)}
				>
					{isPending ? "Updating…" : "Resume subscription"}
				</Button>
			) : (
				<Button
					variant="outline"
					size="sm"
					disabled={isPending}
					onClick={() => setCancelDialogOpen(true)}
				>
					Cancel subscription
				</Button>
			)}

			<AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel at period end?</AlertDialogTitle>
						<AlertDialogDescription>
							There will be no future renewals. The subscription is scheduled to
							end
							{effectiveDate ? ` on ${effectiveDate}` : " at the period end"}.
							Credits remain usable only through their paid-through date
							{paidThroughDate ? ` (${paidThroughDate})` : ""}; cancellation
							does not extend that date.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isPending}>
							Keep subscription
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={isPending}
							onClick={(event) => {
								event.preventDefault();
								updateCancellation(true);
							}}
						>
							{isPending ? "Scheduling…" : "Cancel at period end"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
