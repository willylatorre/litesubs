"use client";

import { useState } from "react";
import { getCustomerDetails } from "@/app/actions/customers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { ManageSubscriptionCreditsDialog } from "./manage-subscription-credits-dialog";
import { DecreaseCreditButton } from "./decrease-credit-button";
import { PaymentLinkButton } from "./payment-link-button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

interface CustomerDetailsDialogProps {
	customerId: string;
	customer: {
		name: string;
		email: string;
		image?: string | null;
	};
	initialSubscriptions: {
		id: string; // product id
		name: string;
		subscriptionId: string;
		credits: number;
	}[];
	children?: React.ReactNode;
	demoData?: {
		totalSpent: number;
		subscriptions: any[];
		transactions: any[];
	};
}

export function CustomerDetailsDialog({
	customerId,
	customer,
	initialSubscriptions,
	children,
	demoData,
}: CustomerDetailsDialogProps) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();

	const { data: fetchedData, isLoading: isQueryLoading } = useQuery({
		queryKey: ["customer-details", customerId],
		queryFn: async () => {
			const res = await getCustomerDetails(customerId);
			if (res.success) return res.data;
			throw new Error(res.error as string);
		},
		enabled: open && !demoData,
	});

	const data = demoData || fetchedData;
	const isLoading = !demoData && isQueryLoading;

	const subscriptions = isLoading
		? initialSubscriptions.map((s) => ({
			id: s.subscriptionId,
			credits: s.credits,
			product: { name: s.name },
			productId: s.id,
		  }))
		: data?.subscriptions || [];

	const handleSuccess = () => {
		if (demoData) return;
		queryClient.invalidateQueries({ queryKey: ["customer-details", customerId] });
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				{children || (
					<Button variant="ghost" size="sm">
						View
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
				<DialogHeader className="flex flex-row items-center gap-4 space-y-0">
					<Avatar className="h-10 w-10">
						<AvatarImage src={customer.image || ""} alt={customer.name} />
						<AvatarFallback>
							{customer.name?.substring(0, 2).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div className="flex flex-col text-left">
						<DialogTitle className="text-lg font-bold">
							{customer.name}
						</DialogTitle>
						<DialogDescription className="text-xs">
							{customer.email}
						</DialogDescription>
					</div>
				</DialogHeader>

				<div className="flex flex-col gap-6 pt-4">
					<div className="flex flex-col gap-0.5">
						<span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
							Total Spent
						</span>
						{isLoading ? (
							<Skeleton className="h-6 w-24" />
						) : (
							<span className="text-sm font-medium">
								{new Intl.NumberFormat("en-US", {
									style: "currency",
									currency: "USD",
								}).format((data?.totalSpent || 0) / 100)}
							</span>
						)}
					</div>

					<div className="flex flex-col gap-3">
						<span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
							Active Subscriptions
						</span>
						<div className="flex flex-col">
							{subscriptions.length === 0 ? (
								<p className="text-muted-foreground text-xs italic">
									No active subscriptions.
								</p>
							) : (
								subscriptions.map((sub: any, index: number) => (
									<div
										key={sub.id}
										className={`flex items-center justify-between py-3 ${
											index < subscriptions.length - 1
												? "border-b border-border/40"
												: ""
										}`}
									>
										<div className="flex flex-col">
											<span className="text-sm font-medium">
												{sub.product.name}
											</span>
											<span className="text-[10px] text-muted-foreground font-mono">
												{sub.productId.substring(0, 8)}
											</span>
										</div>
										<div className="flex items-center gap-4">
											<div className="flex items-baseline gap-1">
												<span className="text-sm font-bold">{sub.credits}</span>
												<span className="text-[10px] text-muted-foreground uppercase font-bold">
													cr
												</span>
											</div>
											{!demoData && (
												<div className="flex items-center gap-1">
													<PaymentLinkButton
														customerId={customerId}
														productId={sub.productId}
													/>
													<DecreaseCreditButton
														subscriptionId={sub.id}
														currentCredits={sub.credits}
														size="sm"
														onSuccess={handleSuccess}
													/>
													<ManageSubscriptionCreditsDialog
														subscriptionId={sub.id}
														planName={sub.product.name}
														currentCredits={sub.credits}
														onSuccess={handleSuccess}
													/>
												</div>
											)}
										</div>
									</div>
								))
							)}
						</div>
					</div>

					<div className="flex flex-col gap-3">
						<span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
							Recent Transactions
						</span>
						{isLoading ? (
							<div className="space-y-2">
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
							</div>
						) : (data?.transactions?.length || 0) === 0 ? (
							<p className="text-muted-foreground text-xs italic">
								No transactions found.
							</p>
						) : (
							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="h-8 text-[10px]">Date</TableHead>
											<TableHead className="h-8 text-[10px]">Type</TableHead>
											<TableHead className="h-8 text-[10px] text-right">
												Amount
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data?.transactions?.map((tx: any) => (
											<TableRow key={tx.id} className="h-8">
												<TableCell className="py-1 text-xs text-muted-foreground">
													{new Date(tx.createdAt).toLocaleDateString()}
												</TableCell>
												<TableCell className="py-1 text-xs capitalize">
													{tx.type.replace("_", " ")}
												</TableCell>
												<TableCell
													className={`py-1 text-xs text-right font-mono ${
														tx.amount > 0 ? "text-green-600" : "text-red-600"
													}`}
												>
													{tx.amount > 0 ? "+" : ""}
													{tx.amount}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
