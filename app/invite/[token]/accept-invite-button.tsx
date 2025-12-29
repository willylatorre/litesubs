"use client";

import { useState, useTransition } from "react";
import { claimInvite } from "@/app/actions/invites";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";

interface AcceptInviteButtonProps {
	token: string;
	label?: string;
	className?: string;
}

export function AcceptInviteButton({
	token,
	label = "Accept Invite",
	className,
}: AcceptInviteButtonProps) {
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	const handleAccept = () => {
		startTransition(async () => {
			try {
				const result = await claimInvite(token);
				if (result.success) {
					toast.success("Invite accepted successfully!");
					router.push("/dashboard");
				} else {
					toast.error(result.error || "Failed to accept invite");
				}
			} catch (error) {
				toast.error("An unexpected error occurred");
			}
		});
	};

	return (
		<Button
			onClick={handleAccept}
			disabled={isPending}
			className={className}
			size="lg"
		>
			{isPending && <Spinner className="mr-2 h-4 w-4" />}
			{label}
		</Button>
	);
}
