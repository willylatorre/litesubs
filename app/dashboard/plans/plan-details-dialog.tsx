"use client";

import { IconMailPlus, IconUsers } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getPlanDetails } from "@/app/actions/plans";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useCalEventTypes, useUpdatePlanCalEventType } from "@/hooks/use-cal";
import { InviteUserDialog } from "../creator/invite-user-dialog";

export function PlanDetailsDialog({
	planId,
	children,
}: {
	planId: string;
	children?: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [selectedEventTypeId, setSelectedEventTypeId] = useState("none");
	const { data: calEventTypesData, isLoading: calLoading } = useCalEventTypes();
	const { mutate: updateEventType, isPending: isUpdating } =
		useUpdatePlanCalEventType();

	const { data: details, isLoading: loading } = useQuery({
		queryKey: ["plan-details", planId],
		queryFn: async () => {
			const res = await getPlanDetails(planId);
			if (res.success) return res.data;
			throw new Error("Failed to fetch plan details");
		},
		enabled: open,
		staleTime: 30000,
	});

	const plan = details?.plan;
	const versions = plan?.versions ?? [];
	const draft = versions.find((version) => version.status === "draft");
	const published = versions.find((version) => version.status === "published");
	const terms = draft ?? published;
	const isDraft = !published;

	const enrollments = details?.enrollments ?? [];
	const displayedEnrollments = enrollments.slice(0, 5);
	const hasMore = enrollments.length > 5;
	const selectedEventType =
		calEventTypesData?.eventTypes.find(
			(eventType) => String(eventType.id) === selectedEventTypeId,
		) ?? null;

	useEffect(() => {
		const eventTypeId = plan?.integration?.calcomIntegration?.eventTypeId;
		setSelectedEventTypeId(eventTypeId ? String(eventTypeId) : "none");
	}, [plan?.integration?.calcomIntegration?.eventTypeId]);

	return (
		<>
			<InviteUserDialog
				open={inviteOpen}
				onOpenChange={setInviteOpen}
				defaultPlanId={planId}
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
							Terms, booking integration, and enrolled customers.
						</DialogDescription>
					</DialogHeader>

					{loading || !plan ? (
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
									<span className="text-lg font-bold">{plan.name}</span>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium text-muted-foreground">
										Status
									</span>
									<div>
										{isDraft ? (
											<Badge variant="secondary">Draft — not purchasable</Badge>
										) : (
											<Badge variant="default">Published</Badge>
										)}
									</div>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium text-muted-foreground">
										Price
									</span>
									<span className="font-mono">
										{terms
											? `${new Intl.NumberFormat("en-US", {
													style: "currency",
													currency: terms.currency.toUpperCase(),
												}).format(
													terms.price / 100,
												)}${terms.billingMode === "recurring" ? " / month" : ""}`
											: "—"}
									</span>
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-sm font-medium text-muted-foreground">
										Credits
									</span>
									<span className="font-mono">{terms?.credits ?? "—"}</span>
								</div>
							</div>

							{isDraft && (
								<p className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
									This plan is a draft. Publishing requires a connected Stripe
									account so the creator can charge customers directly.
								</p>
							)}

							<div className="flex flex-col gap-3 border-t pt-4">
								<h3 className="font-semibold">Cal.com booking</h3>
								<div className="grid gap-2">
									<Label htmlFor="plan-cal-event-type">Event type</Label>
									<Select
										value={selectedEventTypeId}
										onValueChange={setSelectedEventTypeId}
										disabled={!calEventTypesData?.connected || calLoading}
									>
										<SelectTrigger id="plan-cal-event-type">
											<SelectValue
												placeholder={
													calLoading
														? "Loading event types..."
														: "Select an event type"
												}
											/>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="none">No event type</SelectItem>
											{calEventTypesData?.eventTypes.map((eventType) => (
												<SelectItem
													key={eventType.id}
													value={String(eventType.id)}
												>
													{eventType.name || eventType.slug}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{!calEventTypesData?.connected && !calLoading && (
										<p className="text-xs text-muted-foreground">
											Connect Cal.com in{" "}
											<Link
												href="/dashboard/integrations"
												className="underline underline-offset-4"
											>
												Integrations
											</Link>{" "}
											to attach an event type.
										</p>
									)}
									<Button
										variant="outline"
										size="sm"
										className="w-fit"
										disabled={
											isUpdating ||
											(!selectedEventType &&
												!plan.integration?.calcomIntegration?.eventTypeId) ||
											(!!selectedEventType &&
												selectedEventType.id ===
													plan.integration?.calcomIntegration?.eventTypeId)
										}
										onClick={() =>
											updateEventType({
												planId: plan.id,
												eventType: selectedEventType,
											})
										}
									>
										{isUpdating ? "Saving..." : "Save event type"}
									</Button>
								</div>
							</div>

							<div className="flex flex-col gap-4 border-t pt-4">
								<h3 className="font-semibold flex items-center gap-2">
									<IconUsers className="h-4 w-4" />
									Enrollments ({enrollments.length})
								</h3>

								<div className="rounded-md border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Customer</TableHead>
												<TableHead>Email</TableHead>
												<TableHead className="text-right">
													Credits Left
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{displayedEnrollments.length === 0 ? (
												<TableRow>
													<TableCell
														colSpan={3}
														className="text-center h-24 text-muted-foreground"
													>
														No enrollments yet.
													</TableCell>
												</TableRow>
											) : (
												displayedEnrollments.map((enrollment) => (
													<TableRow key={enrollment.id}>
														<TableCell className="font-medium">
															<div className="flex items-center gap-2">
																<Avatar className="h-6 w-6">
																	<AvatarImage
																		src={enrollment.user.image ?? undefined}
																		alt={enrollment.user.name}
																	/>
																	<AvatarFallback>
																		{enrollment.user.name
																			?.substring(0, 2)
																			.toUpperCase()}
																	</AvatarFallback>
																</Avatar>
																{enrollment.user.name}
															</div>
														</TableCell>
														<TableCell>{enrollment.user.email}</TableCell>
														<TableCell className="text-right font-mono">
															{enrollment.credits}
														</TableCell>
													</TableRow>
												))
											)}
										</TableBody>
									</Table>
								</div>

								{hasMore && (
									<div className="flex justify-center">
										<Button variant="ghost" size="sm" asChild>
											<Link href="/dashboard/customers">See all customers</Link>
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
						{!isDraft && (
							<Button onClick={() => setInviteOpen(true)}>
								<IconMailPlus className="mr-2 h-4 w-4" />
								Generate Invite Link
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
