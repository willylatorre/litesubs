import { Suspense } from "react";
import { getCreatorStats } from "@/app/actions/dashboard";
import { getSampleWorkspace } from "@/app/actions/sample-data";
import { SectionCards, SectionCardsSkeleton } from "@/components/section-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { CreatePackDialog } from "../packs/create-pack-dialog";
import { GettingStarted } from "./getting-started";
import { InviteUserDialog } from "./invite-user-dialog";
import { LivePacks } from "./live-packs";
import { RecentInvites } from "./recent-invites";

export const dynamic = "force-dynamic";

// One fetch feeds both the onboarding card and the stat cards, and the whole
// block streams in below the already-rendered page header.
async function CreatorOverview() {
	const [stats, sample] = await Promise.all([
		getCreatorStats(),
		getSampleWorkspace(),
	]);
	const sampleLoaded = Boolean(sample.data?.loaded);
	const isEmpty = stats.activeProducts === 0 && stats.totalCustomers === 0;

	return (
		<>
			{sample.data && (
				<GettingStarted
					initialSample={sample.data}
					isEmpty={isEmpty}
					activeProducts={stats.activeProducts}
					totalCustomers={stats.totalCustomers}
				/>
			)}
			<SectionCards
				totalRevenue={stats.totalRevenue}
				activeProducts={stats.activeProducts}
				totalCustomers={stats.totalCustomers}
				includesSample={sampleLoaded}
			/>
		</>
	);
}

function OverviewSkeleton() {
	return (
		<div className="space-y-4">
			<Skeleton className="mx-4 h-[164px] rounded-xl lg:mx-6" />
			<SectionCardsSkeleton />
		</div>
	);
}

export default function CreatorDashboardPage() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				{/* This renders immediately */}
				<div className="flex items-center justify-between px-4 lg:px-6">
					<h1 className="text-2xl font-bold tracking-tight">
						Creator Dashboard
					</h1>
					<div className="flex gap-2">
						<InviteUserDialog />
						<CreatePackDialog />
					</div>
				</div>

				<Suspense fallback={<OverviewSkeleton />}>
					<CreatorOverview />
				</Suspense>

				<div className="grid gap-4 px-4 lg:px-6 lg:grid-cols-2">
					{/* Live Packs Section */}
					<LivePacks />

					{/* Recent Invites Section */}
					<RecentInvites />
				</div>
			</div>
		</div>
	);
}
