"use client";

import { ChevronRight } from "lucide-react";
import { CustomerDetailsDialog } from "@/app/dashboard/customers/customer-details-dialog";
import type { DemoPlanData } from "@/components/landing/create-plan-dialog-demo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

interface CustomersTableDemoProps {
	plan: DemoPlanData;
}

export function CustomersTableDemo({ plan }: CustomersTableDemoProps) {
	const customer = {
		name: "Jane Doe",
		email: "jane@example.com",
		image: "",
		credits: plan.credits,
		updatedAt: new Date(),
	};

	const demoData = {
		totalSpent: plan.price * 100,
		enrollments: [
			{
				id: "demo-enrollment-id",
				planId: "demo-plan-id",
				plan: { name: plan.name },
				credits: plan.credits,
			},
		],
		transactions: [
			{
				id: "demo-tx-id",
				createdAt: new Date().toISOString(),
				type: "purchase",
				amount: plan.price,
			},
		],
	};

	const initialEnrollments = [
		{
			id: "demo-plan-id",
			name: plan.name,
			enrollmentId: "demo-enrollment-id",
			credits: plan.credits,
		},
	];

	return (
		<div className="rounded-md border bg-card w-full max-w-3xl shadow-sm">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Customer</TableHead>
						<TableHead>Active Plans</TableHead>
						<TableHead>Total Credits</TableHead>
						<TableHead>Last Updated</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="font-medium">
							<div className="flex items-center gap-3">
								<Avatar className="h-8 w-8">
									<AvatarImage src={customer.image} alt={customer.name} />
									<AvatarFallback>JD</AvatarFallback>
								</Avatar>
								<div className="flex flex-col text-left">
									<span>{customer.name}</span>
									<span className="text-xs text-muted-foreground">
										{customer.email}
									</span>
								</div>
							</div>
						</TableCell>
						<TableCell>
							<div className="flex flex-wrap gap-1">
								<Badge variant="secondary" className="text-xs">
									{plan.name}
								</Badge>
							</div>
						</TableCell>
						<TableCell className="font-mono text-lg">
							{customer.credits}
						</TableCell>
						<TableCell className="text-muted-foreground text-sm">
							{customer.updatedAt.toLocaleDateString()}
						</TableCell>
						<TableCell className="text-right">
							<div className="flex items-center justify-end gap-2">
								<CustomerDetailsDialog
									customerId="demo-id"
									customer={{
										name: customer.name,
										email: customer.email,
										image: customer.image,
									}}
									initialEnrollments={initialEnrollments}
									demoData={demoData}
								>
									<Button variant="ghost" size="sm">
										Details
										<ChevronRight className="ml-2 h-4 w-4" />
									</Button>
								</CustomerDetailsDialog>
							</div>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>
	);
}
