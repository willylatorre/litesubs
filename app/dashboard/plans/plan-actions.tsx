"use client";

import {
	IconDotsVertical,
	IconMailPlus,
	IconPencil,
} from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InviteUserDialog } from "../creator/invite-user-dialog";
import { EditPlanDialog } from "./edit-plan-dialog";

export function PlanActions({
	planId,
	isDraft,
}: {
	planId: string;
	isDraft: boolean;
}) {
	const [inviteOpen, setInviteOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);

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
					{!isDraft && (
						<DropdownMenuItem onSelect={() => setInviteOpen(true)}>
							<IconMailPlus className="mr-2 h-4 w-4" />
							Generate Invite Link
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
