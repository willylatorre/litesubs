"use client";

import {
	IconCopy,
	IconDotsVertical,
	IconExternalLink,
	IconMailPlus,
} from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InviteUserDialog } from "../creator/invite-user-dialog";

export function PackActions({ packId }: { packId: string }) {
	const [inviteOpen, setInviteOpen] = useState(false);

	return (
		<>
			<InviteUserDialog
				open={inviteOpen}
				onOpenChange={setInviteOpen}
				defaultPackId={packId}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" className="h-8 w-8 p-0">
						<span className="sr-only">Open menu</span>
						<IconDotsVertical className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => setInviteOpen(true)}>
						<IconMailPlus className="mr-2 h-4 w-4" />
						Generate Invite Link
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
