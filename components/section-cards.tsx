import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

interface SectionCardsProps {
	totalRevenue: number;
	activeProducts: number;
	totalCustomers: number;
}

export function SectionCards({
	totalRevenue,
	activeProducts,
	totalCustomers,
}: SectionCardsProps) {
	return (
		<div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Total Revenue</CardDescription>
					<CardTitle className="stat-card-value @[250px]/card:text-3xl">
						${(totalRevenue / 100).toFixed(2)}
					</CardTitle>
				</CardHeader>
			</Card>
			<Card className="stat-card @container/card">
				<CardHeader>
					<CardDescription>Active Plans</CardDescription>
					<CardTitle className="stat-card-value @[250px]/card:text-3xl">
						{activeProducts}
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
