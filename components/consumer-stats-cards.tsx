import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

interface ConsumerStatsCardsProps {
	totalSpent: number;
	enrollmentCount: number;
}

export function ConsumerStatsCards({
	totalSpent,
	enrollmentCount,
}: ConsumerStatsCardsProps) {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2">
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Total Spent</CardDescription>
					<CardTitle className="stat-card-value @[250px]/card:text-3xl">
						${(totalSpent / 100).toFixed(2)}
					</CardTitle>
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
