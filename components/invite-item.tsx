"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { respondToInvite } from "@/app/actions/invites";
import { PlanCard, type PlanCardProduct } from "@/components/plan-card";
import { Button } from "@/components/ui/button";

export function InviteItem({ invite }: { invite: any }) {
	const [isLoading, setIsLoading] = useState(false);
	const [isPending] = useTransition();
	const router = useRouter();

	const handleRespond = async (accept: boolean) => {
		setIsLoading(true);
		try {
			const result = await respondToInvite(invite.id, accept);
			if (result.error) {
				toast.error(result.error);
			} else {
				toast.success(accept ? "Invite accepted" : "Invite declined");
				router.refresh();
			}
		} catch {
			toast.error("Something went wrong");
		} finally {
			setIsLoading(false);
		}
	};

	// Map the invited plan to the shared card shape.
	const product: PlanCardProduct = invite.plan
		? {
				name: invite.plan.name,
				credits: invite.plan.credits,
				price: invite.plan.price,
				description: invite.plan.description,
				badge: "Invite",
				currency: invite.plan.currency,
				billingMode: invite.plan.billingMode,
				interval: invite.plan.interval,
				eventTypeName: invite.plan.calEventTypeName,
			}
		: {
				name: "Connection Invite",
				credits: 0,
				price: 0,
				description: `Invite from ${invite.creator.name}`,
				badge: "Invite",
				currency: "usd",
			};

	return (
		<div className="relative group animate-in fade-in zoom-in duration-300">
			<PlanCard
				product={product}
				creatorName={invite.creator.name}
				creditsSuffix="credits in the plan"
				action={
					<div className="flex gap-2 w-full">
						<Button
							size="sm"
							variant="destructive"
							onClick={() => handleRespond(false)}
							disabled={isLoading || isPending}
							className="flex-1"
						>
							Reject
						</Button>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => handleRespond(true)}
							disabled={isLoading || isPending}
							className="flex-1"
						>
							Accept
						</Button>
					</div>
				}
				className="border-primary/20 bg-primary/5 pt-8"
			/>
		</div>
	);
}
