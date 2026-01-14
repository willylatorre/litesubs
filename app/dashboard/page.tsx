import { Suspense } from "react";
import { getDashboardData } from "@/app/actions/dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardClient } from "./dashboard-client";

// Force dynamic rendering to ensure fresh data
export const dynamic = "force-dynamic";

function DashboardSkeleton() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				<div className="flex items-center justify-between px-4 lg:px-6">
					<Skeleton className="h-8 w-32" />
				</div>
				<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2">
					<Skeleton className="h-[120px] w-full rounded-xl" />
					<Skeleton className="h-[120px] w-full rounded-xl" />
				</div>
				<div className="px-4 lg:px-6">
					<Skeleton className="h-6 w-48 mb-4" />
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						<Skeleton className="h-[200px] w-full rounded-xl" />
						<Skeleton className="h-[200px] w-full rounded-xl" />
						<Skeleton className="h-[200px] w-full rounded-xl" />
					</div>
				</div>
			</div>
		</div>
	);
}

async function DashboardContent() {
	const data = await getDashboardData();

	// Minimize serialization at RSC boundary - extract only required fields
	// This reduces payload size and improves hydration performance
	const clientData = {
		stats: {
			totalSpent: data.stats.totalSpent,
			activeSubscriptionsCount: data.stats.activeSubscriptionsCount,
		},
		subscriptions: data.subscriptions.map((sub) => ({
			id: sub.id,
			credits: sub.credits,
			product: {
				id: sub.product.id,
				name: sub.product.name,
				price: sub.product.price,
				description: sub.product.description,
				currency: sub.product.currency,
			},
			creator: sub.creator ? { name: sub.creator.name } : null,
		})),
		pendingInvites: data.pendingInvites.map((invite) => ({
			id: invite.id,
			product: invite.product
				? {
						name: invite.product.name,
						credits: invite.product.credits,
						price: invite.product.price,
						description: invite.product.description,
						currency: invite.product.currency,
					}
				: null,
			creator: { name: invite.creator.name },
		})),
	};

	return (
		<Suspense fallback={<DashboardSkeleton />}>
			<DashboardClient initialData={clientData} />
		</Suspense>
	);
}

export default async function Page() {
	return (
		<Suspense fallback={<DashboardSkeleton />}>
			<DashboardContent />
		</Suspense>
	);
}
