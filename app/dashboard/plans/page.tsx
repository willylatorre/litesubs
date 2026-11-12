"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { usePlans } from "@/hooks/use-plans";
import { isSamplePlanId } from "@/lib/sample-data";
import { CreatePlanDialog } from "./create-plan-dialog";
import { PlanActions } from "./plan-actions";
import { PlanDetailsDialog } from "./plan-details-dialog";

function formatMoney(amount: number, currency: string) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(amount / 100);
}

export default function PlansPage() {
	const { data: plans, isLoading, isError } = usePlans();

	if (isError) {
		return <div className="p-6 text-red-500">Failed to load plans.</div>;
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Plans</h1>
					<p className="text-muted-foreground text-sm">
						Prepare offers here. Published plans sell credits; drafts stay
						visible to you only.
					</p>
				</div>
				<CreatePlanDialog />
			</div>

			<div className="rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Terms</TableHead>
							<TableHead>Credits</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							["a", "b", "c"].map((row) => (
								<TableRow key={row}>
									<TableCell>
										<Skeleton className="h-4 w-[100px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[80px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[50px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[60px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[20px] ml-auto" />
									</TableCell>
								</TableRow>
							))
						) : plans?.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="h-32 text-center">
									<div className="flex flex-col items-center gap-3">
										<p className="text-muted-foreground">
											No plans yet. A plan is a bundle of credits you sell — for
											example 10 tutoring sessions for $100.
										</p>
										<p className="text-sm text-muted-foreground">
											Use{" "}
											<span className="font-medium text-foreground">
												Create Plan
											</span>{" "}
											above, or{" "}
											<Link
												href="/dashboard/creator"
												className="underline underline-offset-4"
											>
												load a sample plan
											</Link>{" "}
											to see how everything fits together.
										</p>
									</div>
								</TableCell>
							</TableRow>
						) : (
							plans?.map((plan) => (
								<TableRow key={plan.id}>
									<TableCell className="font-medium">
										<PlanDetailsDialog planId={plan.id}>
											<div className="flex flex-col cursor-pointer hover:underline">
												<div className="flex items-center gap-2">
													<span>{plan.name}</span>
													{isSamplePlanId(plan.id) && (
														<Badge variant="outline">Sample</Badge>
													)}
													{plan.integration?.calcomIntegration?.eventTypeId && (
														<Badge variant="outline">cal.com</Badge>
													)}
												</div>
												{plan.description && (
													<span className="text-xs text-muted-foreground">
														{plan.description}
													</span>
												)}
											</div>
										</PlanDetailsDialog>
									</TableCell>
									<TableCell>
										{plan.terms ? (
											<span className="text-sm">
												{formatMoney(plan.terms.price, plan.terms.currency)}
												{plan.terms.billingMode === "recurring" ? (
													<span className="text-muted-foreground">/mo</span>
												) : null}
											</span>
										) : (
											<span className="text-sm text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell>{plan.terms?.credits ?? "—"}</TableCell>
									<TableCell>
										{plan.isDraft ? (
											<Badge variant="secondary">Draft</Badge>
										) : (
											<Badge variant="default">Published</Badge>
										)}
									</TableCell>
									<TableCell className="text-right">
										<PlanActions planId={plan.id} isDraft={plan.isDraft} />
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
			<p className="text-xs text-muted-foreground">
				Draft plans cannot be purchased or invited to. Publishing requires a
				payment-ready Stripe account — set one up under Payments.
			</p>
		</div>
	);
}
