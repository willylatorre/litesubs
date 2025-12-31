"use client";

import { PayoutBalanceCard } from "./payout-balance-card";
import { PayoutHistoryTable } from "./payout-history-table";
import { PayoutFAQ } from "./payout-faq";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface PayoutViewProps {
	balance: any;
	payoutAccount: any;
	history: any[];
}

export function PayoutView({
	balance,
	payoutAccount,
	history,
}: PayoutViewProps) {
	const router = useRouter();

	const refreshData = () => {
		router.refresh();
	};

	return (
		<div className="space-y-4">
			<PayoutBalanceCard
				balance={balance}
				payoutAccount={payoutAccount}
				onPayoutRequested={refreshData}
				onAccountSetup={refreshData}
			/>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
				<Card className="col-span-4">
					<CardHeader>
						<CardTitle>Payout History</CardTitle>
					</CardHeader>
					<CardContent className="pl-2">
						<PayoutHistoryTable history={history} />
					</CardContent>
				</Card>
				<Card className="col-span-3">
					<CardHeader>
						<CardTitle>FAQ</CardTitle>
					</CardHeader>
					<CardContent>
						<PayoutFAQ />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
