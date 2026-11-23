import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MoneyView } from "@/lib/dashboard-view";

/**
 * Supporting detail under a net total: what was collected, what was refunded,
 * and what Litesubs took. Currency is never blended, and refunds and fees are
 * explicit rather than implied — a creator should not have to open Stripe to
 * find out why the number is smaller than the sales.
 */
export function MoneySummary({
	money,
	emptyLabel,
	includesSample,
	showFees = true,
}: {
	money: MoneyView[];
	emptyLabel: string;
	includesSample?: boolean;
	/**
	 * Customers owe the creator, not the platform, so a buyer's view never shows
	 * the creator's application fee (always zero now that there is no commission).
	 */
	showFees?: boolean;
}) {
	if (money.length === 0) {
		return (
			<p className="text-xs text-muted-foreground">
				{emptyLabel}
				{includesSample && " Includes sample data."}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-1">
			{money.map((row) => (
				<p key={row.currency} className="text-xs text-muted-foreground">
					{formatMoney(row.gross, row.currency)} collected
					{row.refunded > 0 && (
						<>
							{" · "}
							{formatMoney(row.refunded, row.currency)} refunded
						</>
					)}
					{showFees && row.platformFees > 0 && (
						<>
							{" · "}
							{formatMoney(row.platformFees, row.currency)} Litesubs fee
						</>
					)}
				</p>
			))}
			{includesSample && (
				<p className="text-[11px] text-muted-foreground">
					Includes sample data
				</p>
			)}
		</div>
	);
}

export function formatMoney(value: number, currency: string) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(value / 100);
}

interface SectionCardsProps {
	money: MoneyView[];
	totalPlans: number;
	totalCustomers: number;
	/** True when the figures include the removable sample workspace rows. */
	includesSample?: boolean;
}

export function SectionCards({
	money,
	totalPlans,
	totalCustomers,
	includesSample = false,
}: SectionCardsProps) {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Collected</CardDescription>
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
					<MoneySummary
						money={money}
						emptyLabel="No confirmed payments yet."
						includesSample={includesSample}
					/>
				</CardHeader>
			</Card>
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Plans</CardDescription>
					<CardTitle className="stat-card-value @[250px]/card:text-3xl">
						{totalPlans}
					</CardTitle>
				</CardHeader>
			</Card>
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Total Customers</CardDescription>
					<CardTitle className="stat-card-value @[250px]/card:text-3xl">
						{totalCustomers}
					</CardTitle>
				</CardHeader>
			</Card>
		</div>
	);
}

export function SectionCardsSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Collected</CardDescription>
					<Skeleton className="h-8 w-24 mt-1" />
				</CardHeader>
			</Card>
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Plans</CardDescription>
					<Skeleton className="h-8 w-16 mt-1" />
				</CardHeader>
			</Card>
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Total Customers</CardDescription>
					<Skeleton className="h-8 w-16 mt-1" />
				</CardHeader>
			</Card>
		</div>
	);
}
