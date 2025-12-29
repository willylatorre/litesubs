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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCreateInvite } from "@/hooks/use-invites";
import { useProducts } from "@/hooks/use-products";

interface InviteUserDialogProps {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultPackId?: string;
	trigger?: React.ReactNode;
}

export function InviteUserDialog({
	open: controlledOpen,
	onOpenChange: controlledOnOpenChange,
	defaultPackId,
	trigger,
}: InviteUserDialogProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isControlled = controlledOpen !== undefined;

	const open = isControlled ? controlledOpen : internalOpen;
	const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

	const [inviteLink, setInviteLink] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const { mutate, isPending } = useCreateInvite();
	const { data: packs } = useProducts();

	// Reset state when dialog opens/closes
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
		const packId = formData.get("packId") as string;

		mutate(
			{
				email: formData.get("email") as string,
				productId: packId && packId !== "none" ? packId : undefined,
			},
			{
				onSuccess: (data) => {
					// Assume data contains the token or full invite object
					// Adjust based on actual API response type.
					// The API returns the new invite object which has a token.
					const link = `${window.location.origin}/invite/${data.token}`;
					setInviteLink(link);
					toast.success("Invite link generated!");
				},
			},
		);
	}

	const copyToClipboard = () => {
		if (inviteLink) {
			navigator.clipboard.writeText(inviteLink);
			setCopied(true);
			toast.success("Link copied to clipboard");
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{!isControlled && (
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
							? "Share this link with the user to invite them."
							: "Create a unique invite link for a user."}
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
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="email" className="text-right">
								Email (Optional)
							</Label>
							<Input
								id="email"
								name="email"
								type="email"
								className="col-span-3"
								placeholder="user@example.com"
							/>
						</div>
						<div className="grid grid-cols-4 items-center gap-4">
							<Label htmlFor="packId" className="text-right">
								Link Plan
							</Label>
							<div className="col-span-3">
								<Select name="packId" defaultValue={defaultPackId || "none"}>
									<SelectTrigger>
										<SelectValue placeholder="Select a plan (optional)" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">None</SelectItem>
										{packs?.map((pack) => (
											<SelectItem key={pack.id} value={pack.id}>
												{pack.name} ({pack.credits} credits)
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
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
