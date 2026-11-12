import { ArrowLeft, CreditCard } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserEnrollmentDetails } from "@/app/actions/dashboard";
import { getUserTransactions } from "@/app/actions/transactions";
import { BuyButton } from "@/components/buy-button";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export default async function EnrollmentDetailPage({
	params,
}: {
	params: Promise<{ enrollmentId: string }>;
}) {
	const { enrollmentId } = await params;
	const detailsRes = await getUserEnrollmentDetails(enrollmentId);

	if (!detailsRes.success || !detailsRes.data) {
		return notFound();
	}

	const enrollment = detailsRes.data;
	const plan = enrollment.plan;
	const published = plan.versions.find(
		(version) => version.status === "published",
	);
	const recurring = published?.billingMode === "recurring";
	const transactionsRes = await getUserTransactions(plan.id);
	const transactions = transactionsRes.success
		? (transactionsRes.data ?? [])
		: [];
	const calEventTypeUrl = plan.integration?.calcomIntegration?.eventTypeUrl;
	const canBook = Boolean(calEventTypeUrl);
	const hasCredits = enrollment.credits > 0;

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
						<h1 className="text-2xl font-bold tracking-tight">{plan.name}</h1>
						<p className="text-muted-foreground text-sm">
							By {enrollment.creator.name}
							{recurring ? " · renews monthly" : ""}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{canBook &&
						(hasCredits ? (
							<Button size="lg" asChild>
								<Link href={calEventTypeUrl as string} target="_blank">
									Book
								</Link>
							</Button>
						) : (
							<Button size="lg" disabled>
								Book
							</Button>
						))}
					{/* Monthly plans are subscription-only in v1; no paid top-ups. */}
					{!recurring && published && (
						<BuyButton
							disabled={!published}
							planId={plan.id}
							price={published.price}
							currency={published.currency}
							productName={plan.name}
							label="Top up Credits"
							fullWidth={false}
						/>
					)}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				<Card className="stat-card @container/card">
					<CardHeader>
						<CardDescription>Credits Left</CardDescription>
						<CardTitle className="stat-card-value @[250px]/card:text-3xl">
							{enrollment.credits}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card className="stat-card @container/card">
					<CardHeader>
						<CardDescription>Plan</CardDescription>
						<CardTitle className="text-lg">
							{published
								? `${new Intl.NumberFormat("en-US", {
										style: "currency",
										currency: published.currency.toUpperCase(),
									}).format(
										published.price / 100,
									)}${recurring ? " / month" : " one-time"}`
								: "Unavailable"}
						</CardTitle>
					</CardHeader>
				</Card>
			</div>

			<div className="mt-6">
				<h2 className="section-title flex items-center gap-2 mb-4">
					<CreditCard className="h-5 w-5" />
					Credit History
				</h2>
				<div className="table-container">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Date</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Description</TableHead>
								<TableHead className="text-right">Usable after</TableHead>
								<TableHead className="text-right">Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{transactions.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										className="text-center h-24 text-muted-foreground"
									>
										No credit history recorded.
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
										<TableCell className="max-w-[220px]">
											<span
												className="block truncate"
												title={tx.description || ""}
											>
												{tx.description || "-"}
											</span>
											{/* A usage debit shows which grants paid for it, so
											    spending is attributable rather than an opaque number. */}
											{tx.allocations?.length ? (
												<span className="text-xs text-muted-foreground">
													from {tx.allocations.length} credit source
													{tx.allocations.length === 1 ? "" : "s"}
												</span>
											) : null}
										</TableCell>
										<TableCell className="text-right font-mono text-muted-foreground">
											{tx.balanceAfter ?? "—"}
										</TableCell>
										<TableCell
											className={`text-right font-mono font-medium ${tx.amount > 0 ? "text-green-600" : "text-red-600"}`}
										>
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
