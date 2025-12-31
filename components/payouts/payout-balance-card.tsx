import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestPayoutDialog } from "./request-payout-dialog";
import { SetupPayoutAccount } from "./setup-payout-account";

export interface PayoutBalance {
	totalEarnings: number;
	platformFees: number;
	totalPaidOut: number;
	totalRefunds: number;
	pendingPayouts: number;
	availableBalance: number;
	canRequestPayout: boolean;
	minimumPayout: number;
	platformFeePercent: number;
}

export interface PayoutAccount {
	id: string;
	userId: string;
	verificationStatus: "pending" | "verified" | "failed";
	stripeRecipientId: string | null;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

interface PayoutBalanceCardProps {
	balance: PayoutBalance;
	payoutAccount: PayoutAccount | null | undefined;
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
		totalPaidOut,
		pendingPayouts,
		availableBalance,
		canRequestPayout,
		minimumPayout,
		platformFeePercent,
	} = balance;

	const isAccountVerified =
		payoutAccount?.verificationStatus === "verified" &&
		payoutAccount?.stripeRecipientId;

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
								platformFeePercent={platformFeePercent}
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
