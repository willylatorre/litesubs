"use client";

import { IconLink, IconMailPlus } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { ShareLinkActions } from "@/components/share-link-actions";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCreateInvite } from "@/hooks/use-invites";
import { usePlans } from "@/hooks/use-plans";
import { rehostUrl } from "@/lib/share-link";

interface InviteCustomerDialogProps {
	/** Controlled mode: the caller owns the trigger. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Suppress the built-in button when the caller renders its own menu item. */
	hideTrigger?: boolean;
	defaultPlanId?: string;
	trigger?: React.ReactNode;
	/** Copy for the entry point, so the same flow can read as "invite" or "add". */
	triggerLabel?: string;
	title?: string;
	description?: string;
}

/**
 * Turn an email and an optional plan into a link the creator can forward.
 *
 * Nothing is emailed: this product has no mailer, so the link *is* the
 * invitation, and the creator is the one who delivers it. That makes the
 * generated link the most important thing on the screen — it gets copy, the
 * native share sheet, and its expiry, not a toast that disappears.
 */
export function InviteCustomerDialog({
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	hideTrigger = false,
	defaultPlanId,
	trigger,
	triggerLabel = "Invite customer",
	title = "Invite a customer",
	description = "Create a private link for one person. No email is sent — you forward the link yourself.",
}: InviteCustomerDialogProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isControlled = controlledOpen !== undefined;

	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = isControlled
		? (controlledOnOpenChange ?? (() => undefined))
		: setInternalOpen;

	const [invite, setInvite] = useState<{
		url: string;
		email: string | null;
		expiresAt: string | null;
	} | null>(null);
	const [planId, setPlanId] = useState(defaultPlanId ?? "none");

	const { mutate, isPending } = useCreateInvite();
	const { data: plans } = usePlans();
	// Invites target published plans only; drafts are not sellable.
	const sellable = plans?.filter((plan) => !plan.isDraft) ?? [];
	// Public links embed the creator's username, so a brand-new account cannot
	// mint one yet. Say that up front instead of failing after the form.
	const [needsUsername, setNeedsUsername] = useState(false);

	function handleOpenChange(newOpen: boolean) {
		setOpen(newOpen);
		if (!newOpen) {
			// Delay so the closing animation does not flash an empty form.
			setTimeout(() => {
				setInvite(null);
				setPlanId(defaultPlanId ?? "none");
				setNeedsUsername(false);
			}, 300);
		}
	}

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const email = (formData.get("email") as string).trim();

		mutate(
			{
				email: email || undefined,
				planId: planId !== "none" ? planId : undefined,
			},
			{
				onSuccess: (data) => {
					setInvite({
						// The path is canonical; the host must be this deployment's, or a
						// preview creator would hand out a production URL that 404s.
						url: rehostUrl(data.url, window.location.origin),
						email: data.email,
						expiresAt: data.expiresAt
							? new Date(data.expiresAt).toISOString()
							: null,
					});
					toast.success(data.email ? "Invite link ready" : "Link ready");
				},
				onError: (error: Error & { code?: string }) => {
					// The hook already toasted the message; this only needs to offer
					// the fix, which is choosing a username in Account.
					if (error.code === "USERNAME_REQUIRED") setNeedsUsername(true);
				},
			},
		);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{!isControlled && !hideTrigger && (
				<DialogTrigger asChild>
					{trigger || (
						<Button size="sm">
							<IconMailPlus className="mr-2 size-4" />
							{triggerLabel}
						</Button>
					)}
				</DialogTrigger>
			)}
			<DialogContent className="sm:max-w-[460px]">
				<DialogHeader>
					<DialogTitle>{invite ? "Invite link ready" : title}</DialogTitle>
					<DialogDescription>
						{invite
							? `Send this link to ${invite.email ?? "your customer"}. They create an account, then accept it.`
							: description}
					</DialogDescription>
				</DialogHeader>

				{invite ? (
					<div className="flex flex-col gap-4 py-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="invite-link">Invite link</Label>
							<Input
								id="invite-link"
								readOnly
								value={invite.url}
								className="font-mono text-xs"
								onFocus={(e) => e.currentTarget.select()}
							/>
						</div>
						<ShareLinkActions
							url={invite.url}
							title="You're invited to LiteSubs"
							text={
								invite.email
									? `Your invite for ${invite.email} is ready.`
									: "Your invite link is ready."
							}
						/>
						<p className="text-xs text-muted-foreground">
							{invite.expiresAt
								? `This link works until ${new Date(invite.expiresAt).toLocaleDateString()}, once.`
								: "This link can be claimed once."}
							{invite.email && " Only that email address can accept it."}
						</p>
						<DialogFooter>
							<Button
								variant="secondary"
								onClick={() => handleOpenChange(false)}
							>
								Done
							</Button>
						</DialogFooter>
					</div>
				) : (
					<form onSubmit={onSubmit} className="grid gap-4 py-4">
						{needsUsername && (
							<div className="rounded-md border border-primary/30 bg-primary/[0.04] p-3 text-sm">
								<p className="font-medium">Choose a username first</p>
								<p className="text-muted-foreground">
									Invite links include your public username.{" "}
									<a
										href="/dashboard/account"
										className="underline underline-offset-4"
									>
										Set one in Account
									</a>{" "}
									and come back.
								</p>
							</div>
						)}
						<div className="grid gap-2">
							<Label htmlFor="invite-email">Customer email</Label>
							<Input
								id="invite-email"
								name="email"
								type="email"
								placeholder="customer@example.com"
								autoComplete="off"
							/>
							<p className="text-xs text-muted-foreground">
								Leave it blank for a link anyone can claim.
							</p>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="invite-plan">Plan</Label>
							<Select value={planId} onValueChange={setPlanId}>
								<SelectTrigger id="invite-plan" className="w-full">
									<SelectValue placeholder="No specific plan" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No specific plan</SelectItem>
									{sellable.map((plan) => (
										<SelectItem key={plan.id} value={plan.id}>
											{plan.name} · {plan.terms?.credits ?? 0} credits
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{sellable.length === 0 && (
								<p className="text-xs text-muted-foreground">
									Publish a plan first to invite someone to buy it. Without a
									plan the link only connects you.
								</p>
							)}
						</div>
						<DialogFooter>
							<Button type="submit" disabled={isPending}>
								{isPending ? (
									"Creating link..."
								) : (
									<>
										<IconLink className="mr-2 size-4" />
										Create invite link
									</>
								)}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
