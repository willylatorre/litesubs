import { IconAlertCircle } from "@tabler/icons-react";
import Link from "next/link";
import {
	getConsumerStats,
	getUserSubscriptions,
} from "@/app/actions/dashboard";
import { getUserPendingInvites } from "@/app/actions/invites";
import { ConsumerStatsCards } from "@/components/consumer-stats-cards";
import { InviteItem } from "@/components/invite-item";
import { PackItem } from "@/components/pack-item";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default async function Page() {
	const [stats, subscriptions, pendingInvites] = await Promise.all([
		getConsumerStats(),
		getUserSubscriptions(),
		getUserPendingInvites(),
	]);

	const hasLowCredits = subscriptions.some((sub) => sub.credits < 2);

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
					<h2 className="text-lg font-semibold my-4">Active Subscriptions</h2>

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

					{hasLowCredits && (
						<Alert variant="default" className="bg-primary/5 border-primary/20">
							<IconAlertCircle className="size-4" />
							<AlertTitle>Low Credits</AlertTitle>
							<AlertDescription>
								You have less than 2 credits left on one or more subscriptions.
								Please buy a pack below to add more credits.
							</AlertDescription>
						</Alert>
					)}
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{subscriptions.length === 0 ? (
							<div className="col-span-full flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-card text-muted-foreground">
								<p>You don't have any active subscriptions or credits yet.</p>
							</div>
						) : (
							subscriptions.map((sub) => (
								<PackItem
									key={sub.id}
									product={{
										name: sub.creator?.name || "Unknown Creator",
										credits: sub.credits,
										price: 0,
										description: "Current Balance",
									}}
									creatorName={sub.creator?.name}
									creditsSuffix=" available"
									packs={sub.packs}
								/>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
