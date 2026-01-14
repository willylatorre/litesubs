"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPackDetails } from "@/app/actions/products";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { IconMailPlus, IconUsers } from "@tabler/icons-react";
import { InviteUserDialog } from "../creator/invite-user-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export function PackDetailsDialog({
	packId,
	children,
}: {
	packId: string;
	children?: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [inviteOpen, setInviteOpen] = useState(false);

	// Use React Query for automatic caching and deduplication
	const { data: details, isLoading: loading } = useQuery({
		queryKey: ["pack-details", packId],
		queryFn: async () => {
			const res = await getPackDetails(packId);
			if (res.success) {
				return res.data;
			}
			throw new Error("Failed to fetch pack details");
		},
		enabled: open, // Only fetch when dialog opens
		staleTime: 30000, // Cache for 30 seconds
	});

	const displayedSubscribers = details?.subscribers?.slice(0, 5) || [];
	const hasMoreSubscribers = (details?.subscribers?.length || 0) > 5;

	return (
		<>
			<InviteUserDialog
				open={inviteOpen}
				onOpenChange={setInviteOpen}
				defaultPackId={packId}
			/>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>
					{children || (
						<Button variant="ghost" size="sm">
							View
						</Button>
					)}
				</DialogTrigger>
				<DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Plan Details</DialogTitle>
						<DialogDescription>
							View details and customers for this plan.
						</DialogDescription>
					</DialogHeader>

					{loading || !details ? (
						<div className="flex justify-center p-8">
							<Spinner />
						</div>
					) : (
						<div className="flex flex-col gap-6">
							<div className="grid grid-cols-2 gap-4">
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium text-muted-foreground">
										Name
									</span>
									<span className="text-lg font-bold">
										{details.product.name}
									</span>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium text-muted-foreground">
										Status
									</span>
									<div>
										<Badge
											variant={details.product.active ? "default" : "secondary"}
										>
											{details.product.active ? "Active" : "Disabled"}
										</Badge>
									</div>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium text-muted-foreground">
										Price
									</span>
									<span className="font-mono">
										{new Intl.NumberFormat("en-US", {
											style: "currency",
											currency: details.product.currency.toUpperCase(),
										}).format(details.product.price / 100)}
									</span>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium text-muted-foreground">
										Credits
									</span>
									<span className="font-mono">{details.product.credits}</span>
								</div>
							</div>

							<div className="flex flex-col gap-4 border-t pt-4">
								<h3 className="font-semibold flex items-center gap-2">
									<IconUsers className="h-4 w-4" />
									Customers ({details.subscribers.length})
								</h3>

								<div className="rounded-md border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>User</TableHead>
												<TableHead>Email</TableHead>
												<TableHead className="text-right">Credits Left</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{displayedSubscribers.length === 0 ? (
												<TableRow>
													<TableCell
														colSpan={3}
														className="text-center h-24 text-muted-foreground"
													>
														No customers yet.
													</TableCell>
												</TableRow>
											) : (
												displayedSubscribers.map((sub: any) => (
													<TableRow key={sub.id}>
														<TableCell className="font-medium">
															<div className="flex items-center gap-2">
																<Avatar className="h-6 w-6">
																	<AvatarImage
																		src={sub.user.image}
																		alt={sub.user.name}
																	/>
																	<AvatarFallback>
																		{sub.user.name?.substring(0, 2).toUpperCase()}
																	</AvatarFallback>
																</Avatar>
																{sub.user.name}
															</div>
														</TableCell>
														<TableCell>{sub.user.email}</TableCell>
														<TableCell className="text-right font-mono">
															{sub.credits}
														</TableCell>
													</TableRow>
												))
											)}
										</TableBody>
									</Table>
								</div>
								
								{hasMoreSubscribers && (
									<div className="flex justify-center">
										<Button variant="ghost" size="sm" asChild>
											<Link href="/dashboard/customers">
												See all customers
											</Link>
										</Button>
									</div>
								)}
							</div>
						</div>
					)}
					<DialogFooter className="pt-2">
						<Button variant="outline" onClick={() => setOpen(false)}>
							Close
						</Button>
						<Button onClick={() => setInviteOpen(true)}>
							<IconMailPlus className="mr-2 h-4 w-4" />
							Generate Invite Link
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
