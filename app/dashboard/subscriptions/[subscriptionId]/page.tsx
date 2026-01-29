import { getUserSubscriptionDetails } from "@/app/actions/dashboard";
import { getUserTransactions } from "@/app/actions/transactions";
import { BuyButton } from "@/components/buy-button";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ArrowLeft, CreditCard } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function SubscriptionDetailPage({
	params,
}: {
	params: Promise<{ subscriptionId: string }>;
}) {
    const { subscriptionId } = await params;
	const detailsRes = await getUserSubscriptionDetails(subscriptionId);

	if (!detailsRes.success || !detailsRes.data) {
		return notFound();
	}

	const sub = detailsRes.data;
	const transactionsRes = await getUserTransactions(sub.productId);
	const transactions = transactionsRes.success ? transactionsRes.data : [];
	const calEventTypeUrl = sub.product.integration?.calcomIntegration?.eventTypeUrl;
	const canBook = Boolean(calEventTypeUrl);
	const hasCredits = sub.credits > 0;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Button variant="outline" size="icon" asChild>
						<Link href="/dashboard">
							<ArrowLeft className="h-4 w-4" />
						</Link>
					</Button>
					<div>
						<h1 className="text-2xl font-bold tracking-tight">{sub.product.name}</h1>
						<p className="text-muted-foreground text-sm">
							By {sub.creator.name}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{canBook &&
						(hasCredits ? (
							<Button size="lg" asChild>
								<Link href={calEventTypeUrl} target="_blank">
									Book
								</Link>
							</Button>
						) : (
							<Button size="lg" disabled>
								Book
							</Button>
						))}
					<BuyButton
						disabled={!sub.productId}
						productId={sub.productId}
						price={sub.product.price}
						currency={sub.product.currency}
						productName={sub.product.name}
						label="Top up Credits"
						fullWidth={false}
					/>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="stat-card @container/card">
					<CardHeader>
						<CardDescription>Credits Left</CardDescription>
						<CardTitle className="stat-card-value @[250px]/card:text-3xl">
							{sub.credits}
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

			<div className="mt-6">
				<h2 className="section-title flex items-center gap-2 mb-4">
					<CreditCard className="h-5 w-5" />
					Transaction Ledger
				</h2>
				<div className="table-container">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Date</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Description</TableHead>
								<TableHead className="text-right">Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{transactions.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={4}
										className="text-center h-24 text-muted-foreground"
									>
										No transactions recorded.
									</TableCell>
								</TableRow>
							) : (
								transactions.map((tx) => (
									<TableRow key={tx.id}>
										<TableCell className="text-xs text-muted-foreground">
											{new Date(tx.createdAt).toLocaleString()}
										</TableCell>
										<TableCell className="capitalize">
											{tx.type.replace("_", " ")}
										</TableCell>
										<TableCell className="max-w-[200px] truncate" title={tx.description || ""}>
											{tx.description || "-"}
										</TableCell>
										<TableCell className={`text-right font-mono font-medium ${tx.amount > 0 ? "text-green-600" : "text-red-600"}`}>
											{tx.amount > 0 ? "+" : ""}
											{tx.amount}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	);
}
