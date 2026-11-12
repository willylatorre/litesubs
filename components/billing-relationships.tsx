"use client";

import { useQuery } from "@tanstack/react-query";
import { getUserBillingRelationships } from "@/app/actions/dashboard";
import { ManageBillingButton } from "@/components/manage-billing-button";
import { Skeleton } from "@/components/ui/skeleton";

export function BillingRelationships() {
	const { data = [], isLoading } = useQuery({
		queryKey: ["billing-relationships"],
		queryFn: getUserBillingRelationships,
		staleTime: 30_000,
	});

	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-lg font-semibold">Billing relationships</h2>
				<p className="text-sm text-muted-foreground">
					Each creator has a separate Stripe billing portal for your payment
					method and invoices. This is not the creator&apos;s Stripe Dashboard.
				</p>
			</div>
			{isLoading ? (
				<div className="space-y-2">
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			) : data.length === 0 ? (
				<p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
					Monthly subscriptions you start will appear here.
				</p>
			) : (
				<div className="divide-y rounded-md border">
					{data.map((billing) => {
						const effectiveDate = billing.cancelAt ?? billing.paidThroughAt;
						const price = new Intl.NumberFormat("en-US", {
							style: "currency",
							currency: billing.planVersion.currency.toUpperCase(),
						}).format(billing.planVersion.price / 100);
						const status = billing.overdue
							? "Payment overdue"
							: billing.status === "canceled"
								? "Subscription ended"
								: billing.cancelAtPeriodEnd
									? "Scheduled to end"
									: billing.status === "active"
										? "Active"
										: "Payment processing";
						return (
							<div
								key={billing.id}
								className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0">
									<p className="font-medium">{billing.plan.name}</p>
									<p className="text-sm text-muted-foreground">
										{billing.creator.name} · {price}
										{billing.planVersion.interval === "month" ? " / month" : ""}
									</p>
									<p
										className={`mt-1 text-xs ${billing.overdue ? "text-destructive" : "text-muted-foreground"}`}
									>
										{status}
										{effectiveDate && (
											<>
												{" "}
												· through {new Date(effectiveDate).toLocaleDateString()}
											</>
										)}
									</p>
								</div>
								<ManageBillingButton subscriptionId={billing.id} />
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
