"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import {
	getConsumerStats,
	getUserSubscriptions,
} from "@/app/actions/dashboard";
import { getUserPendingInvites } from "@/app/actions/invites";
import { ConsumerStatsCards } from "@/components/consumer-stats-cards";
import { InviteItem } from "@/components/invite-item";
import { PackItem } from "@/components/pack-item";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTransactionCheck } from "@/hooks/use-transaction-check";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// Re-exporting actions to be used in the effect
export { getConsumerStats, getUserSubscriptions, getUserPendingInvites };

export default function Page() {
	const searchParams = useSearchParams();

	const [stats, setStats] = useState<any>({
		totalSpent: 0,
		activeSubscriptionsCount: 0,
	});
	const [subscriptions, setSubscriptions] = useState<any[]>([]);
	const [pendingInvites, setPendingInvites] = useState<any[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const success = searchParams.get("success");
	const purchasedProductId = searchParams.get("productId");

	const fetchData = useCallback(async () => {
		const [statsData, subsData, invitesData] = await Promise.all([
			getConsumerStats(),
			getUserSubscriptions(),
			getUserPendingInvites(),
		]);
		setStats(statsData);
		setSubscriptions(subsData);
		setPendingInvites(invitesData);
		return { statsData, subsData, invitesData };
	}, []);

	// Effect for initial data fetching
	useEffect(() => {
		const init = async () => {
			setIsLoading(true);
			await fetchData();
			setIsLoading(false);
		};
		init();
	}, [fetchData]);

	// Use the custom hook for transaction checking
	useTransactionCheck({
		onSuccess: fetchData,
	});

	const allSubscriptions = subscriptions || [];

	const hasLowCredits = allSubscriptions.some((s: any) => s.credits < 2);

	if (isLoading) {
		return <div>Loading...</div>; // Or a proper skeleton loader
	}

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
						Active Subscriptions
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
								Please buy a pack below to add more credits.
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
								{allSubscriptions.map((sub: any) => {
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
											isLoading={isPurchased}
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
