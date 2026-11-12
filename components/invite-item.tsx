"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { respondToInvite } from "@/app/actions/invites";
import { PlanCard, type PlanCardProduct } from "@/components/plan-card";
import { Button } from "@/components/ui/button";
import type { InviteView } from "@/lib/dashboard-view";

export function InviteItem({ invite }: { invite: InviteView }) {
	const [isLoading, setIsLoading] = useState(false);
	const [isPending] = useTransition();
	const router = useRouter();
	const complimentary = invite.compCredits > 0;

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

	// Map the invited plan to the shared card shape. A complimentary invite is
	// never a purchase: it shows the granted units, not a price to pay.
	const product: PlanCardProduct = invite.plan
		? {
				name: invite.plan.name,
				credits: complimentary
					? invite.compCredits
					: (invite.plan.terms?.credits ?? 0),
				price: complimentary ? 0 : (invite.plan.terms?.price ?? 0),
				description: invite.plan.description,
				badge: complimentary ? "Complimentary" : "Invite",
				currency: invite.plan.terms?.currency ?? "usd",
				billingMode: invite.plan.terms?.billingMode,
				interval: invite.plan.terms?.interval ?? null,
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
				creditsSuffix={
					complimentary ? "credits on claim" : "credits in the plan"
				}
				action={
					<div className="flex flex-col gap-2 w-full">
						{complimentary && invite.compExpiresAt && (
							<p className="text-xs text-muted-foreground text-center">
								Granted once. Usable until{" "}
								{new Date(invite.compExpiresAt).toLocaleDateString()}.
							</p>
						)}
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
					</div>
				}
				className="border-primary/20 bg-primary/5 pt-8"
			/>
		</div>
	);
}
