"use client";

import {
	IconCircleCheck,
	IconCircleOff,
	IconDotsVertical,
	IconMailPlus,
	IconPencil,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { publishPlanAction, unpublishPlanAction } from "@/app/actions/plans";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { InviteUserDialog } from "../creator/invite-user-dialog";
import { EditPlanDialog } from "./edit-plan-dialog";

export function PlanActions({
	planId,
	isDraft,
	hasDraftChanges = false,
}: {
	planId: string;
	isDraft: boolean;
	/** A live offer exists, but the draft holds newer terms to publish. */
	hasDraftChanges?: boolean;
}) {
	const [inviteOpen, setInviteOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const [unpublishOpen, setUnpublishOpen] = useState(false);
	const [pending, setPending] = useState<"publish" | "unpublish" | null>(null);
	const queryClient = useQueryClient();
	const router = useRouter();

	function refresh() {
		queryClient.invalidateQueries({ queryKey: ["plans"] });
		queryClient.invalidateQueries({ queryKey: ["plan-details"] });
		router.refresh();
	}

	async function publish() {
		setPending("publish");
		const result = await publishPlanAction(planId);
		setPending(null);
		if (result.error) return toast.error(result.error);
		refresh();
		toast.success(
			result.data?.status === "unchanged"
				? "Already published with these terms"
				: result.data?.status === "already_published"
					? "This plan is already published"
					: `Published: ${result.data?.terms.credits} credits for ${(
							(result.data?.terms.price ?? 0) / 100
						).toFixed(2)} ${result.data?.terms.currency.toUpperCase()}`,
		);
	}

	async function unpublish() {
		setPending("unpublish");
		const result = await unpublishPlanAction(planId);
		setPending(null);
		setUnpublishOpen(false);
		if (result.error) return toast.error(result.error);
		refresh();
		if (result.data?.message) toast.warning(result.data.message);
		else toast.success("Unpublished. New sales are stopped.");
	}

	const canPublish = isDraft || hasDraftChanges;

	return (
		<>
			<EditPlanDialog
				planId={planId}
				open={editOpen}
				onOpenChange={setEditOpen}
			/>
			<InviteUserDialog
				open={inviteOpen}
				onOpenChange={setInviteOpen}
				defaultPlanId={planId}
				hideTrigger
			/>
			<AlertDialog open={unpublishOpen} onOpenChange={setUnpublishOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Unpublish this plan?</AlertDialogTitle>
						<AlertDialogDescription>
							New customers can no longer buy it. People who already purchased
							keep their credits, and nothing is refunded or deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending === "unpublish"}>
							Keep selling
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								void unpublish();
							}}
							disabled={pending === "unpublish"}
						>
							{pending === "unpublish" ? <Spinner className="mr-2" /> : null}
							Unpublish
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" className="h-8 w-8 p-0">
						<span className="sr-only">Open menu</span>
						<IconDotsVertical className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => setEditOpen(true)}>
						<IconPencil className="mr-2 h-4 w-4" />
						Edit plan
					</DropdownMenuItem>
					{canPublish && (
						<DropdownMenuItem
							onSelect={() => void publish()}
							disabled={pending !== null}
						>
							<IconCircleCheck className="mr-2 h-4 w-4" />
							{isDraft ? "Publish" : "Publish changes"}
						</DropdownMenuItem>
					)}
					{!isDraft && (
						<DropdownMenuItem onSelect={() => setInviteOpen(true)}>
							<IconMailPlus className="mr-2 h-4 w-4" />
							Generate Invite Link
						</DropdownMenuItem>
					)}
					{!isDraft && (
						<DropdownMenuItem
							onSelect={() => setUnpublishOpen(true)}
							disabled={pending !== null}
						>
							<IconCircleOff className="mr-2 h-4 w-4" />
							Unpublish
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
