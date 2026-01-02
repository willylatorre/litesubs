"use client";

import { useRouter } from "next/navigation";
import {
	IconCreditCard,
	IconPercentage,
	IconReceipt,
	IconTrendingUp,
} from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectStatusCard } from "./connect-status-card";
import type { StripeConnectStatus } from "@/app/db/stripe-connect-schema";
import { formatCurrency } from "@/lib/utils";

interface ConnectPayoutsViewProps {
	connectAccount: {
		stripeAccountId: string;
		accountType: string;
		status: StripeConnectStatus;
		chargesEnabled: boolean;
		payoutsEnabled: boolean;
		detailsSubmitted: boolean;
		country?: string | null;
		defaultCurrency?: string | null;
	};
	stats: {
		totalTransactions: number;
		totalVolume: number;
		totalApplicationFees: number;
		currency: string;
	};
}

export function ConnectPayoutsView({
	connectAccount,
	stats,
}: ConnectPayoutsViewProps) {
	const router = useRouter();

	const handleStatusUpdated = () => {
		router.refresh();
	};

	return (
		<div className="space-y-4">
			{/* Connect Status Card */}
			<ConnectStatusCard
				status={connectAccount.status}
				chargesEnabled={connectAccount.chargesEnabled}
				payoutsEnabled={connectAccount.payoutsEnabled}
				detailsSubmitted={connectAccount.detailsSubmitted}
				country={connectAccount.country}
				defaultCurrency={connectAccount.defaultCurrency}
				onStatusUpdated={handleStatusUpdated}
			/>

			{/* Stats Cards */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Total Transactions
						</CardTitle>
						<IconReceipt className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stats.totalTransactions}</div>
						<p className="text-xs text-muted-foreground">
							Payments via Stripe Connect
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Volume</CardTitle>
						<IconTrendingUp className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatCurrency(stats.totalVolume / 100, stats.currency)}
						</div>
						<p className="text-xs text-muted-foreground">
							Gross sales amount
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">
							Your Earnings
						</CardTitle>
						<IconCreditCard className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatCurrency(
								(stats.totalVolume - stats.totalApplicationFees) / 100,
								stats.currency,
							)}
						</div>
						<p className="text-xs text-muted-foreground">
							After platform fees
						</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Platform Fees</CardTitle>
						<IconPercentage className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{formatCurrency(stats.totalApplicationFees / 100, stats.currency)}
						</div>
						<p className="text-xs text-muted-foreground">10% of sales</p>
					</CardContent>
				</Card>
			</div>

			{/* Info Card */}
			<Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
				<CardContent className="flex items-start gap-3 pt-6">
					<div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/50">
						<IconCreditCard className="h-4 w-4 text-blue-600 dark:text-blue-400" />
					</div>
					<div className="space-y-1">
						<p className="text-sm font-medium">
							Payments go directly to your Stripe account
						</p>
						<p className="text-xs text-muted-foreground">
							With Stripe Connect, all payments are automatically transferred to
							your connected Stripe account after the platform fee is deducted.
							You can manage your payouts, view transaction details, and
							configure your bank account directly in your Stripe Dashboard.
						</p>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
