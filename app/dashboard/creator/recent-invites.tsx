"use client";

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
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: 3 }).map((_, i) => (
								<TableRow key={i}>
									<TableCell>
										<Skeleton className="h-4 w-[150px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[60px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[80px] ml-auto" />
									</TableCell>
								</TableRow>
							))
						) : invites?.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={3}
									className="text-center text-muted-foreground"
								>
									No invites sent yet.
								</TableCell>
							</TableRow>
						) : (
							invites?.slice(0, 5).map((invite) => (
								<TableRow key={invite.id}>
									<TableCell className="font-medium">{invite.email}</TableCell>
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
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
