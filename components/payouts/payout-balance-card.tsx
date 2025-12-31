import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, DollarSign, Wallet } from "lucide-react";
import { RequestPayoutDialog } from "./request-payout-dialog";
import { SetupPayoutAccount } from "./setup-payout-account";

interface PayoutBalanceCardProps {
	balance: {
		totalEarnings: number;
		platformFees: number;
		totalPaidOut: number;
		pendingPayouts: number;
		availableBalance: number;
		canRequestPayout: boolean;
		minimumPayout: number;
	};
	payoutAccount: any;
	onPayoutRequested: () => void;
	onAccountSetup: () => void;
}

export function PayoutBalanceCard({
	balance,
	payoutAccount,
	onPayoutRequested,
	onAccountSetup,
}: PayoutBalanceCardProps) {
	const {
		totalEarnings,
		platformFees,
		totalPaidOut,
		pendingPayouts,
		availableBalance,
		canRequestPayout,
		minimumPayout,
	} = balance;

	const isAccountVerified =
		payoutAccount?.verificationStatus === "verified" &&
		payoutAccount?.stripeAccountId;

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<Card className="col-span-2 lg:col-span-2">
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Available Balance
					</CardTitle>
					<div className="flex items-baseline justify-between">
						<span className="text-3xl font-bold">
							${availableBalance.toFixed(2)}
						</span>
						{pendingPayouts > 0 && (
							<span className="text-sm text-muted-foreground">
								${pendingPayouts.toFixed(2)} pending
							</span>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="text-xs text-muted-foreground mb-4">
						Minimum payout: ${minimumPayout.toFixed(2)}
					</div>
					<div className="flex gap-2">
						{isAccountVerified ? (
							<RequestPayoutDialog
								availableBalance={availableBalance}
								minimumPayout={minimumPayout}
								onSuccess={onPayoutRequested}
								disabled={!canRequestPayout || pendingPayouts > 0}
								platformFeePercent={10} // Hardcoded for display as per prompt
							/>
						) : (
							<SetupPayoutAccount
								payoutAccount={payoutAccount}
								onSuccess={onAccountSetup}
							/>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Total Earnings
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">${totalEarnings.toFixed(2)}</div>
					<p className="text-xs text-muted-foreground">
						Gross earnings before fees
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm font-medium text-muted-foreground">
						Total Paid Out
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">${totalPaidOut.toFixed(2)}</div>
					<p className="text-xs text-muted-foreground">
						Successfully transferred
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
