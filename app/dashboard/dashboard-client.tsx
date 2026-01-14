"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { getDashboardData } from "@/app/actions/dashboard";
import { BuyButton } from "@/components/buy-button";
import { ConsumerStatsCards } from "@/components/consumer-stats-cards";
import { InviteItem } from "@/components/invite-item";
import { PackItem } from "@/components/pack-item";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTransactionCheck } from "@/hooks/use-transaction-check";

// Minimized types for RSC boundary serialization
interface SubscriptionData {
	id: string;
	credits: number;
	product: {
		id: string;
		name: string;
		price: number;
		description: string | null;
		currency: string;
	};
	creator: { name: string } | null;
}

interface InviteData {
	id: string;
	product: {
		name: string;
		credits: number;
		price: number;
		description: string | null;
		currency: string;
	} | null;
	creator: { name: string };
}

interface DashboardClientProps {
	initialData: {
		stats: { totalSpent: number; activeSubscriptionsCount: number };
		subscriptions: SubscriptionData[];
		pendingInvites: InviteData[];
	};
}

export function DashboardClient({ initialData }: DashboardClientProps) {
	const searchParams = useSearchParams();
	const [data, setData] = useState(initialData);
	const [isRefreshing, setIsRefreshing] = useState(false);

	const success = searchParams.get("success");
	const purchasedProductId = searchParams.get("productId");

	const fetchData = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const dashboardData = await getDashboardData();
			setData(dashboardData);
		} catch (error) {
			console.error("Failed to fetch dashboard data:", error);
		} finally {
			setIsRefreshing(false);
		}
	}, []);

	// Use the custom hook for transaction checking
	useTransactionCheck({
		onSuccess: fetchData,
	});

	const { stats, subscriptions, pendingInvites } = data;
	const allSubscriptions = subscriptions || [];
	const hasLowCredits = allSubscriptions.some((s) => s.credits < 2);

	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				<div className="flex items-center justify-between px-4 lg:px-6">
					<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
				</div>

				<ConsumerStatsCards
					totalSpent={stats.totalSpent}
					activeSubscriptionsCount={stats.activeSubscriptionsCount}
				/>

				<div className="flex flex-col gap-4 px-4 lg:px-6">
					{/* Invites */}
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

					<h2 className="text-lg font-semibold mt-4 mb-2">
						Active Credit Plans
					</h2>

					{hasLowCredits && (
						<Alert
							variant="default"
							className="bg-primary/5 border-primary/20 mb-4"
						>
							<IconAlertCircle className="size-4" />
							<AlertTitle>Low Credits</AlertTitle>
							<AlertDescription>
								You have less than 2 credits left on one or more subscriptions.
								Please buy a plan below to add more credits.
							</AlertDescription>
						</Alert>
					)}

					<div className="flex flex-col gap-8">
						{allSubscriptions.length === 0 ? (
							<div className="col-span-full flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-card text-muted-foreground">
								<p>
									You don't have any active subscriptions or credits yet.
								</p>
							</div>
						) : (
							<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
								{allSubscriptions.map((sub) => {
									const isPurchased =
										success && sub.product.id === purchasedProductId;
									return (
										<PackItem
											key={sub.id}
											productId={sub.product.id}
											product={{
												name: sub.product.name,
												credits: sub.credits,
												price: sub.product.price,
												description: sub.product.description,
												currency: sub.product.currency,
											}}
											creditsSuffix=" credits left"
											creatorName={sub.creator?.name}
											isLoading={isPurchased || isRefreshing}
											action={
												<div className="flex items-center gap-2 w-full">
													<Button variant="outline" size="sm" className="flex-1" asChild>
														<Link href={`/dashboard/subscriptions/${sub.id}`}>Details</Link>
													</Button>
													<div className="flex-1">
														<BuyButton
															disabled={!sub.product.id}
															productId={sub.product.id}
															price={sub.product.price}
															currency={sub.product.currency}
															productName={sub.product.name}
															label="Top up"
														/>
													</div>
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
