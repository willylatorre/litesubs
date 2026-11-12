"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { DecreaseCreditButton } from "./decrease-credit-button";
import { EnrollmentMoreActions } from "./enrollment-more-actions";
import { ManageEnrollmentCreditsDialog } from "./manage-enrollment-credits-dialog";

type CustomerEnrollmentView = {
	id: string;
	credits: number;
	planId: string;
	plan: { name: string };
	billingSubscription?: {
		status: "pending" | "incomplete" | "active" | "past_due" | "canceled";
		paidThroughAt: Date | null;
		cancelAtPeriodEnd: boolean;
		overdue: boolean;
	} | null;
};

type CustomerTransactionView = {
	id: string;
	createdAt: Date | string;
	type: string;
	amount: number;
	description?: string | null;
};

interface CustomerDetailsDialogProps {
	customerId: string;
	customer: {
		name: string;
		email: string;
		image?: string | null;
	};
	initialEnrollments: {
		id: string; // plan id
		name: string;
		enrollmentId: string;
		credits: number;
		billingSubscription?: {
			status: "pending" | "incomplete" | "active" | "past_due" | "canceled";
			paidThroughAt: Date | null;
			cancelAtPeriodEnd: boolean;
			overdue: boolean;
		} | null;
	}[];
	children?: React.ReactNode;
	demoData?: {
		totalSpent: number;
		enrollments: CustomerEnrollmentView[];
		transactions: CustomerTransactionView[];
	};
}

export function CustomerDetailsDialog({
	customerId,
	customer,
	initialEnrollments,
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

	const enrollments: CustomerEnrollmentView[] = isLoading
		? initialEnrollments.map((enrollment) => ({
				id: enrollment.enrollmentId,
				credits: enrollment.credits,
				plan: { name: enrollment.name },
				planId: enrollment.id,
				billingSubscription: enrollment.billingSubscription,
			}))
		: (data?.enrollments ?? []);

	const handleSuccess = () => {
		if (demoData) return;
		queryClient.invalidateQueries({
			queryKey: ["customer-details", customerId],
		});
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
							Enrollments
						</span>
						<div className="flex flex-col">
							{enrollments.length === 0 ? (
								<p className="text-muted-foreground text-xs italic">
									No enrollments.
								</p>
							) : (
								enrollments.map((enrollment, index) => (
									<div
										key={enrollment.id}
										className={`flex items-center justify-between py-3 ${
											index < enrollments.length - 1
												? "border-b border-border/40"
												: ""
										}`}
									>
										<div className="flex flex-col">
											<span className="text-sm font-medium">
												{enrollment.plan.name}
											</span>
											<span className="text-[10px] text-muted-foreground font-mono">
												{enrollment.planId.substring(0, 8)}
											</span>
											{enrollment.billingSubscription && (
												<span
													className={`text-[10px] ${enrollment.billingSubscription.overdue ? "text-destructive" : "text-muted-foreground"}`}
												>
													{enrollment.billingSubscription.overdue
														? "Payment overdue"
														: enrollment.billingSubscription.status}
													{enrollment.billingSubscription.paidThroughAt && (
														<>
															{" "}
															· paid through{" "}
															{new Date(
																enrollment.billingSubscription.paidThroughAt,
															).toLocaleDateString()}
														</>
													)}
												</span>
											)}
										</div>
										<div className="flex items-center gap-4">
											<div className="flex items-baseline gap-1">
												<span className="text-sm font-bold">
													{enrollment.credits}
												</span>
												<span className="text-[10px] text-muted-foreground uppercase font-bold">
													cr
												</span>
											</div>
											{!demoData && (
												<div className="flex items-center gap-0.5">
													<DecreaseCreditButton
														enrollmentId={enrollment.id}
														currentCredits={enrollment.credits}
														size="sm"
														onSuccess={handleSuccess}
														showLabel={false}
													/>
													<ManageEnrollmentCreditsDialog
														enrollmentId={enrollment.id}
														planName={enrollment.plan.name}
														currentCredits={enrollment.credits}
														onSuccess={handleSuccess}
														compact
													/>
													<EnrollmentMoreActions
														customerEmail={customer.email}
														planId={enrollment.planId}
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
							Recent Credit Activity
						</span>
						{isLoading ? (
							<div className="space-y-2">
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
								<Skeleton className="h-8 w-full" />
							</div>
						) : (data?.transactions?.length || 0) === 0 ? (
							<p className="text-muted-foreground text-xs italic">
								No credit activity found.
							</p>
						) : (
							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="h-8 text-[10px]">Date</TableHead>
											<TableHead className="h-8 text-[10px]">Type</TableHead>
											<TableHead className="h-8 text-[10px]">Details</TableHead>
											<TableHead className="h-8 text-[10px] text-right">
												Amount
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data?.transactions?.map((tx: CustomerTransactionView) => (
											<TableRow key={tx.id} className="h-8">
												<TableCell className="py-1 text-xs text-muted-foreground">
													{new Date(tx.createdAt).toLocaleDateString()}
												</TableCell>
												<TableCell className="py-1 text-xs capitalize">
													{tx.type.replace("_", " ")}
												</TableCell>
												<TableCell className="py-1 text-xs text-muted-foreground">
													{tx.description || "—"}
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
