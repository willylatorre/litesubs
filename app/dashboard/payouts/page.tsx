import { Suspense } from "react";
import {
	getAccountBalance,
	getPayoutAccount,
	getPayoutHistory,
	syncPayoutAccountStatus,
} from "@/app/actions/payouts";
import {
	getConnectAccountStatus,
	getConnectTransactionStats,
	syncConnectAccountStatus,
} from "@/app/actions/stripe-connect";
import { PayoutView } from "@/components/payouts/payout-view";
import { ConnectPayoutsView } from "@/components/stripe-connect/connect-payouts-view";

export const dynamic = "force-dynamic";

export default async function PayoutsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const sp = await searchParams;

	// Handle setup callbacks for platform payouts
	if (sp.setup === "complete" || sp.setup === "refresh") {
		await syncPayoutAccountStatus();
	}

	// Handle callbacks for Stripe Connect
	if (sp.connect === "complete" || sp.connect === "refresh") {
		await syncConnectAccountStatus();
	}

	// Check if user has an active Stripe Connect account
	const connectAccountRes = await getConnectAccountStatus();
	const connectAccount = connectAccountRes?.data;

	// If user has an active Connect account, show the Connect view
	const hasActiveConnect = connectAccount?.status === "active";

	if (hasActiveConnect && connectAccount) {
		const statsRes = await getConnectTransactionStats();
		const stats = statsRes?.data || {
			totalTransactions: 0,
			totalVolume: 0,
			totalApplicationFees: 0,
			currency: "usd",
		};

		return (
			<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold tracking-tight">Stripe Connect</h1>
						<p className="text-muted-foreground text-sm">
							Payments go directly to your Stripe account.
						</p>
					</div>
				</div>
				<Suspense fallback={<div>Loading...</div>}>
					<ConnectPayoutsView connectAccount={connectAccount} stats={stats} />
				</Suspense>
			</div>
		);
	}

	// Default: Platform Payouts view
	const [balanceRes, accountRes, historyRes] = await Promise.all([
		getAccountBalance(),
		getPayoutAccount(),
		getPayoutHistory(),
	]);

	const balance = balanceRes?.data || {
		totalEarnings: 0,
		platformFees: 0,
		totalPaidOut: 0,
		totalRefunds: 0,
		pendingPayouts: 0,
		availableBalance: 0,
		canRequestPayout: false,
		minimumPayout: 50,
		platformFeePercent: 10,
	};

	const payoutAccount = accountRes?.data;
	const history = historyRes?.data || [];

	// Show Connect banner if user doesn't have a Connect account or it's not active
	const showConnectBanner = !connectAccount || connectAccount.status !== "active";

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Payouts</h1>
					<p className="text-muted-foreground text-sm">
						Manage your earnings and request payouts.
					</p>
				</div>
			</div>
			<Suspense fallback={<div>Loading...</div>}>
				<PayoutView
					balance={balance}
					payoutAccount={payoutAccount}
					history={history}
					showConnectBanner={showConnectBanner}
				/>
			</Suspense>
		</div>
	);
}
