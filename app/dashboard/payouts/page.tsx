import { Suspense } from "react";
import {
	getAccountBalance,
	getPayoutAccount,
	getPayoutHistory,
	syncPayoutAccountStatus,
} from "@/app/actions/payouts";
import { getPayoutPreference } from "@/app/actions/payout-preferences";
import {
	getConnectAccountStatus,
	getConnectTransactionStats,
	syncConnectAccountStatus,
} from "@/app/actions/stripe-connect";
import { PayoutMethodSelector } from "@/components/payouts/payout-method-selector";
import { PayoutView } from "@/components/payouts/payout-view";
import { ConnectPayoutsView } from "@/components/stripe-connect/connect-payouts-view";

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

	// Get user's payout preference and Connect status
	const [preferenceRes, connectAccountRes] = await Promise.all([
		getPayoutPreference(),
		getConnectAccountStatus(),
	]);

	const preference = preferenceRes?.data;
	const connectAccount = connectAccountRes?.data;

	// Determine which view to show based on preference and account status
	const hasNoPreference = !preference;
	const isStripeConnect = preference?.method === "stripe_connect";
	const isPlatformPayouts = preference?.method === "platform_payouts";

	// If user chose Connect but hasn't finished onboarding, still show Connect view
	// If user has a Connect account that's active, show Connect view
	const showConnectView =
		isStripeConnect || (connectAccount?.status === "active");

	// No preference selected - show the method selector
	if (hasNoPreference && !connectAccount) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-bold tracking-tight">Payouts</h1>
						<p className="text-muted-foreground text-sm">
							Choose how you&apos;d like to receive your earnings.
						</p>
					</div>
				</div>
				<PayoutMethodSelector />
			</div>
		);
	}

	// Stripe Connect view
	if (showConnectView && connectAccount) {
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

	// Platform Payouts view (current system)
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
					showConnectBanner={isPlatformPayouts}
				/>
			</Suspense>
		</div>
	);
}
