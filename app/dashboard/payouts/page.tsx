import { Suspense } from "react";
import {
	getAccountBalance,
	getPayoutAccount,
	getPayoutHistory,
	syncPayoutAccountStatus,
} from "@/app/actions/payouts";
import { PayoutView } from "@/components/payouts/payout-view";

export default async function PayoutsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const sp = await searchParams;

	// Handle setup callbacks
	if (sp.setup === "complete" || sp.setup === "refresh") {
		await syncPayoutAccountStatus();
	}

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
		<div className="flex-1 space-y-4 p-8 pt-6">
			<div className="flex items-center justify-between space-y-2">
				<h2 className="text-3xl font-bold tracking-tight">Payouts</h2>
			</div>
			<Suspense fallback={<div>Loading...</div>}>
				<PayoutView
					balance={balance}
					payoutAccount={payoutAccount}
					history={history}
				/>
			</Suspense>
		</div>
	);
}
