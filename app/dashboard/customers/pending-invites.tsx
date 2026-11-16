"use client";

import { IconClock } from "@tabler/icons-react";
import { AppShareLinkActions } from "@/components/app-share-link-actions";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useInvites } from "@/hooks/use-invites";
import { isSampleInviteId } from "@/lib/sample-data";

/**
 * Invites that have not been claimed yet, with their live link.
 *
 * The Customers table can only list people who accepted; everyone in between is
 * invisible there. Without this card a creator who lost the link has no way back
 * to it, and the invite silently expires.
 */
export function PendingInvites() {
	const { data: invites, isLoading } = useInvites();

	// `expiresAt` is enforced on claim, so an old row would otherwise look
	// actionable for 14 days after it stopped working.
	const pending = (invites ?? []).filter(
		(invite) =>
			invite.status === "pending" &&
			Boolean(invite.url) &&
			(!invite.expiresAt || new Date(invite.expiresAt).getTime() > Date.now()),
	);

	// This card is additive: most creators have no pending invites most of the
	// time. A skeleton would flash a card that immediately disappears, so it
	// renders only once there is something to show.
	if (isLoading || pending.length === 0) return null;

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-base">Pending invites</CardTitle>
				<CardDescription>
					Not accepted yet. Share the link again or let it expire.
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-2">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Invitee</TableHead>
							<TableHead>Plan</TableHead>
							<TableHead>Expires</TableHead>
							<TableHead className="text-right">Link</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{pending.map((invite) => (
							<TableRow key={invite.id}>
								<TableCell className="font-medium">
									<span className="flex items-center gap-2">
										{invite.email ?? (
											<span className="text-muted-foreground">
												Anyone with the link
											</span>
										)}
										{isSampleInviteId(invite.id) && (
											<Badge variant="outline">Sample</Badge>
										)}
									</span>
								</TableCell>
								<TableCell>
									{invite.plan ? (
										<Badge variant="secondary" className="text-xs">
											{invite.plan.name}
										</Badge>
									) : (
										<span className="text-muted-foreground text-xs">-</span>
									)}
								</TableCell>
								<TableCell className="text-muted-foreground text-sm">
									<span className="flex items-center gap-1">
										<IconClock className="size-3" />
										{invite.expiresAt
											? new Date(invite.expiresAt).toLocaleDateString()
											: "No expiry"}
									</span>
								</TableCell>
								<TableCell>
									<AppShareLinkActions
										url={invite.url as string}
										title="You're invited to LiteSubs"
										compact
										className="flex items-center justify-end gap-1"
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
