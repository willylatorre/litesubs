"use client";

import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import { PlanCard } from "@/components/plan-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlans } from "@/hooks/use-plans";

export function LivePlans() {
	const { data: plans, isLoading } = usePlans();
	const sellable = plans?.filter((plan) => !plan.isDraft) ?? [];

	return (
		<Card className="flex flex-col">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<div className="grid gap-1">
					<CardTitle>Your Published Plans</CardTitle>
					<CardDescription>
						Plans currently available for purchase.
					</CardDescription>
				</div>
				<Button asChild variant="ghost" size="sm" className="hidden sm:flex">
					<Link href="/dashboard/plans">
						View All <IconArrowRight className="ml-2 size-4" />
					</Link>
				</Button>
			</CardHeader>
			<CardContent className="grid gap-4 pt-4">
				{isLoading ? (
					<div className="grid gap-4">
						{["a", "b", "c"].map((row) => (
							<div
								key={row}
								className="flex items-center justify-between rounded-lg border p-3 shadow-sm"
							>
								<div className="space-y-1">
									<Skeleton className="h-4 w-[100px]" />
									<Skeleton className="h-3 w-[60px]" />
								</div>
								<Skeleton className="h-8 w-[80px]" />
							</div>
						))}
					</div>
				) : sellable.length === 0 ? (
					<div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4">
						<p className="text-sm text-muted-foreground">
							No published plans yet. Drafts stay private until Stripe is
							connected and publishing is enabled.
						</p>
						<Button asChild size="sm" variant="outline">
							<Link href="/dashboard/plans">Open plans</Link>
						</Button>
					</div>
				) : (
					<div className="grid gap-4">
						{sellable.slice(0, 5).map((plan) => (
							<PlanCard
								key={plan.id}
								product={{
									name: plan.name,
									credits: plan.terms?.credits ?? 0,
									price: plan.terms?.price ?? 0,
									description: plan.description,
									badge: "Published",
									currency: plan.terms?.currency ?? "usd",
									billingMode: plan.terms?.billingMode ?? "one_time",
									interval: plan.terms?.interval ?? null,
									eventTypeName:
										plan.integration?.calcomIntegration?.eventTypeName,
								}}
								action={
									<Button asChild variant="outline" size="sm">
										<Link href="/dashboard/plans">Manage</Link>
									</Button>
								}
							/>
						))}
					</div>
				)}
				{!isLoading && (plans?.length ?? 0) > sellable.length && (
					<Badge variant="secondary" className="w-fit">
						{(plans?.length ?? 0) - sellable.length} draft
					</Badge>
				)}
			</CardContent>
		</Card>
	);
}
