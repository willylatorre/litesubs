"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getDashboardData } from "@/app/actions/dashboard";
import { BuyButton } from "@/components/buy-button";
import { ConsumerStatsCards } from "@/components/consumer-stats-cards";
import { InviteItem } from "@/components/invite-item";
import { PlanCard } from "@/components/plan-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTransactionCheck } from "@/hooks/use-transaction-check";
import { type DashboardView, toDashboardView } from "@/lib/dashboard-view";

interface DashboardClientProps {
	initialData: DashboardView;
}

export function DashboardClient({ initialData }: DashboardClientProps) {
	const [data, setData] = useState(initialData);
	const [isRefreshing, setIsRefreshing] = useState(false);
	// Track purchased plan ID locally to avoid re-renders from useSearchParams.
	const [purchasedPlanId, setPurchasedPlanId] = useState<string | null>(null);

	// Read params on-demand at mount to avoid subscribing to all URL changes
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const planId = params.get("planId");
		if (planId) {
			setPurchasedPlanId(planId);
		}
	}, []);

	const fetchData = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const dashboardData = await getDashboardData();
			setData(toDashboardView(dashboardData));
		} catch (error) {
			console.error("Failed to fetch dashboard data:", error);
		} finally {
			setIsRefreshing(false);
		}
	}, []);

	// The success page only observes fulfillment; the webhook grants credits.
	useTransactionCheck({
		onSuccess: async () => {
			await fetchData();
			setPurchasedPlanId(null);
		},
	});

	const { stats, enrollments, pendingInvites } = data;
	const allEnrollments = enrollments || [];
	const hasLowCredits = allEnrollments.some(
		(enrollment) => enrollment.credits < 2,
	);

	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				<div className="flex items-center justify-between px-4 lg:px-6">
					<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
				</div>

				<ConsumerStatsCards
					money={stats.money}
					enrollmentCount={stats.enrollmentCount}
				/>

				<div className="flex flex-col gap-4 px-4 lg:px-6">
					{pendingInvites.length > 0 && (
						<div className="space-y-4">
							<h2 className="text-lg font-semibold">Pending Invites</h2>
							<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
								{pendingInvites.map((invite) => (
									<InviteItem key={invite.id} invite={invite} />
								))}
							</div>
						</div>
					)}

					<h2 className="text-lg font-semibold mt-4 mb-2">Active Plans</h2>

					{hasLowCredits && (
						<Alert
							variant="default"
							className="bg-primary/5 border-primary/20 mb-4"
						>
							<IconAlertCircle className="size-4" />
							<AlertTitle>Low Credits</AlertTitle>
							<AlertDescription>
								You have less than 2 credits left on one or more plans. Please
								buy a plan below to add more credits.
							</AlertDescription>
						</Alert>
					)}

					<div className="flex flex-col gap-8">
						{allEnrollments.length === 0 ? (
							<div className="col-span-full flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card p-8 text-center">
								<p className="text-sm text-muted-foreground">
									You have no plans yet. Plans you buy or are invited to show up
									here, with the credits left on each.
								</p>
								<div className="flex flex-wrap items-center justify-center gap-3 text-sm">
									<Link
										href="/dashboard/creator"
										className="rounded-md border px-3 py-1.5 font-medium transition-colors hover:bg-accent"
									>
										I sell credits — open the creator dashboard
									</Link>
									<Link href="/sample" className="underline underline-offset-4">
										See a sample workspace
									</Link>
								</div>
							</div>
						) : (
							<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
								{allEnrollments.map((enrollment) => {
									const isPurchased =
										purchasedPlanId && enrollment.plan.id === purchasedPlanId;
									const subscription = enrollment.subscription;
									const subscriptionEnd =
										subscription?.cancelAt ?? subscription?.paidThroughAt;
									const terms =
										subscription?.status !== "canceled"
											? (subscription?.terms ?? enrollment.plan.terms)
											: enrollment.plan.terms;
									const recurring = terms?.billingMode === "recurring";
									return (
										<PlanCard
											key={enrollment.id}
											productId={enrollment.plan.id}
											product={{
												name: enrollment.plan.name,
												credits: enrollment.credits,
												price: terms?.price ?? 0,
												description: enrollment.plan.description,
												currency: terms?.currency ?? "usd",
												billingMode: terms?.billingMode ?? "one_time",
												interval: terms?.interval ?? null,
												eventTypeName: enrollment.plan.calEventTypeName,
											}}
											creditsSuffix=" credits left"
											creatorName={enrollment.creator?.name}
											isLoading={isPurchased || isRefreshing}
											action={
												<div className="flex items-center gap-2 w-full">
													<Button
														variant="outline"
														size="sm"
														className="flex-1"
														asChild
													>
														<Link
															href={`/dashboard/enrollments/${enrollment.id}`}
														>
															Details
														</Link>
													</Button>
													{/* Monthly plans have no paid top-ups in v1. */}
													{!recurring && (
														<div className="flex-1">
															<BuyButton
																disabled={!terms}
																planId={enrollment.plan.id}
																price={terms?.price ?? 0}
																currency={terms?.currency ?? "usd"}
																productName={enrollment.plan.name}
																label="Top up"
															/>
														</div>
													)}
													{recurring && (
														<div className="flex flex-1 flex-col items-end gap-1">
															{subscription?.overdue ? (
																<p className="text-xs text-destructive text-right">
																	Payment overdue
																	{subscription.paidThroughAt && (
																		<>
																			{" "}
																			· paid through{" "}
																			{new Date(
																				subscription.paidThroughAt,
																			).toLocaleDateString()}
																		</>
																	)}
																</p>
															) : subscription?.status === "canceled" ? (
																<>
																	<p className="text-xs text-muted-foreground text-right">
																		Subscription ended
																	</p>
																	{terms?.billingMode === "recurring" && (
																		<BuyButton
																			planId={enrollment.plan.id}
																			price={terms.price}
																			currency={terms.currency}
																			productName={enrollment.plan.name}
																			billingMode="recurring"
																			credits={terms.credits}
																			label="Subscribe again"
																		/>
																	)}
																</>
															) : subscription?.cancelAtPeriodEnd ? (
																<p className="text-xs text-muted-foreground text-right">
																	Scheduled to end
																	{subscriptionEnd && (
																		<>
																			{" "}
																			·{" "}
																			{new Date(
																				subscriptionEnd,
																			).toLocaleDateString()}
																		</>
																	)}
																</p>
															) : subscription?.status === "active" ? (
																<p className="text-xs text-muted-foreground text-right">
																	Monthly subscription active
																	{subscription.paidThroughAt && (
																		<>
																			{" "}
																			· paid through{" "}
																			{new Date(
																				subscription.paidThroughAt,
																			).toLocaleDateString()}
																		</>
																	)}
																</p>
															) : subscription ? (
																<p className="text-xs text-muted-foreground text-right">
																	Subscription payment processing
																</p>
															) : terms ? (
																<BuyButton
																	planId={enrollment.plan.id}
																	price={terms.price}
																	currency={terms.currency}
																	productName={enrollment.plan.name}
																	billingMode="recurring"
																	credits={terms.credits}
																	label="Subscribe"
																/>
															) : null}
														</div>
													)}
												</div>
											}
										/>
									);
								})}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
