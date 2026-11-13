import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { MoneyView } from "@/lib/dashboard-view";
import { formatMoney } from "./section-cards";

/**
 * Customer spending is receipt-derived. Each currency gets its own line so a
 * USD purchase and a EUR purchase are never added into one meaningless number.
 */
export function ConsumerStatsCards({
	money,
	enrollmentCount,
}: {
	money: MoneyView[];
	enrollmentCount: number;
}) {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2">
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Total Spent</CardDescription>
					{money.length > 0 ? (
						<div className="flex flex-col gap-1">
							{money.map((row) => (
								<CardTitle
									key={row.currency}
									className="stat-card-value @[250px]/card:text-3xl"
								>
									{formatMoney(row.net, row.currency)}
								</CardTitle>
							))}
						</div>
					) : (
						<CardTitle className="stat-card-value @[250px]/card:text-3xl">
							—
						</CardTitle>
					)}
					{money.some((row) => row.refunded > 0) && (
						<p className="text-xs text-muted-foreground">
							After{" "}
							{money
								.map((row) => formatMoney(row.refunded, row.currency))
								.join(", ")}{" "}
							refunded
						</p>
					)}
				</CardHeader>
			</Card>
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Active Plans</CardDescription>
					<CardTitle className="stat-card-value @[250px]/card:text-3xl">
						{enrollmentCount}
					</CardTitle>
				</CardHeader>
			</Card>
		</div>
	);
}
