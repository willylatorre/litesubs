"use client";

import { AppShareLinkActions } from "@/components/app-share-link-actions";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

export function RecentInvites() {
	const { data: invites, isLoading } = useInvites();

	return (
		<Card className="flex flex-col">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<div className="grid gap-1">
					<CardTitle>Recent Invites</CardTitle>
					<CardDescription>
						Invitations sent to potential customers.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent className="grid gap-4 pt-4">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Email</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Date</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							["a", "b", "c"].map((row) => (
								<TableRow key={row}>
									<TableCell>
										<Skeleton className="h-4 w-[150px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[60px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[80px] ml-auto" />
									</TableCell>
									<TableCell />
								</TableRow>
							))
						) : invites?.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={4}
									className="py-8 text-center text-muted-foreground"
								>
									No invites yet. Use{" "}
									<span className="font-medium text-foreground">
										Invite customer
									</span>{" "}
									to create a link you can forward.
								</TableCell>
							</TableRow>
						) : (
							invites?.slice(0, 5).map((invite) => (
								<TableRow key={invite.id}>
									<TableCell className="font-medium">
										<span className="flex items-center gap-2">
											{invite.email}
											{isSampleInviteId(invite.id) && (
												<Badge variant="outline">Sample</Badge>
											)}
										</span>
									</TableCell>
									<TableCell>
										<Badge
											variant={
												invite.status === "accepted"
													? "default"
													: invite.status === "rejected"
														? "destructive"
														: "secondary"
											}
										>
											{invite.status}
										</Badge>
									</TableCell>
									<TableCell className="text-right text-muted-foreground text-sm">
										{new Date(invite.createdAt).toLocaleDateString()}
									</TableCell>
									<TableCell className="w-0">
										{/* A pending invite is the one still worth sending, so only
										    it gets the link controls. */}
										{invite.status === "pending" && invite.url ? (
											<AppShareLinkActions
												url={invite.url}
												compact
												className="flex items-center justify-end gap-1"
											/>
										) : null}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
