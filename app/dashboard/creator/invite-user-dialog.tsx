"use client";

import { IconCheck, IconCopy, IconMailPlus } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { useCreateInvite } from "@/hooks/use-invites";
import { usePlans } from "@/hooks/use-plans";

interface InviteUserDialogProps {
	/** Controlled mode: the caller owns the trigger. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Suppress the built-in button when the caller renders its own menu item. */
	hideTrigger?: boolean;
	defaultPlanId?: string;
	trigger?: React.ReactNode;
}

export function InviteUserDialog({
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	hideTrigger = false,
	defaultPlanId,
	trigger,
}: InviteUserDialogProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isControlled = controlledOpen !== undefined;

	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = isControlled
		? (controlledOnOpenChange ?? (() => undefined))
		: setInternalOpen;

	const [inviteLink, setInviteLink] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const { mutate, isPending } = useCreateInvite();
	const { data: plans } = usePlans();
	// Invites target published plans only; drafts are not sellable.
	const sellable = plans?.filter((plan) => !plan.isDraft) ?? [];

	const handleOpenChange = (newOpen: boolean) => {
		setOpen(newOpen);
		if (!newOpen) {
			setTimeout(() => {
				setInviteLink(null);
				setCopied(false);
			}, 300);
		}
	};

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const planId = formData.get("planId") as string;

		mutate(
			{
				email: formData.get("email") as string,
				planId: planId && planId !== "none" ? planId : undefined,
			},
			{
				onSuccess: (data) => {
					setInviteLink(`${window.location.origin}/invite/${data.token}`);
					toast.success("Invite link generated!");
				},
			},
		);
	}

	const copyToClipboard = () => {
		if (!inviteLink) return;
		navigator.clipboard.writeText(inviteLink);
		setCopied(true);
		toast.success("Link copied to clipboard");
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{!isControlled && !hideTrigger && (
				<DialogTrigger asChild>
					{trigger || (
						<Button size="sm">
							<IconMailPlus className="mr-2 size-4" />
							Generate Invite Link
						</Button>
					)}
				</DialogTrigger>
			)}
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Generate Invite Link</DialogTitle>
					<DialogDescription>
						{inviteLink
							? "Share this link with the customer. No email is sent."
							: "Create a unique invite link for a customer. No email is sent — forward the link yourself."}
					</DialogDescription>
				</DialogHeader>

				{inviteLink ? (
					<div className="flex flex-col gap-4 py-4">
						<div className="flex items-center gap-2">
							<Input
								readOnly
								value={inviteLink}
								className="flex-1 font-mono text-xs"
								onClick={(e) => e.currentTarget.select()}
							/>
							<Button size="icon" variant="outline" onClick={copyToClipboard}>
								{copied ? (
									<IconCheck className="size-4" />
								) : (
									<IconCopy className="size-4" />
								)}
							</Button>
						</div>
						<DialogFooter>
							<Button
								variant="secondary"
								onClick={() => handleOpenChange(false)}
							>
								Close
							</Button>
							<Button onClick={copyToClipboard}>
								{copied ? "Copied" : "Copy Link"}
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form onSubmit={onSubmit} className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="invite-email">Email (optional)</Label>
							<Input
								id="invite-email"
								name="email"
								type="email"
								placeholder="user@example.com"
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="invite-plan">Published plan</Label>
							<select
								id="invite-plan"
								name="planId"
								defaultValue={defaultPlanId || "none"}
								className="h-9 rounded-md border bg-transparent px-3 text-sm"
							>
								<option value="none">No specific plan</option>
								{sellable.map((plan) => (
									<option key={plan.id} value={plan.id}>
										{plan.name} ({plan.terms?.credits ?? 0} credits)
									</option>
								))}
							</select>
							{sellable.length === 0 && (
								<p className="text-xs text-muted-foreground">
									Publish a plan before inviting someone to purchase it.
								</p>
							)}
						</div>
						<DialogFooter>
							<Button type="submit" disabled={isPending}>
								{isPending ? "Generating..." : "Generate Link"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
