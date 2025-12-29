"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import type { DemoPackData } from "./create-pack-demo";

interface CustomersTableDemoProps {
	pack: DemoPackData;
}

export function CustomersTableDemo({ pack }: CustomersTableDemoProps) {
	// Simulated customer data
	const customer = {
		name: "Jane Doe",
		email: "jane@example.com",
		image: "",
		credits: pack.credits,
		activePacks: [pack],
		updatedAt: new Date(),
	};

	return (
		<div className="rounded-md border bg-card w-full max-w-3xl shadow-sm">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Customer</TableHead>
						<TableHead>Active Packs</TableHead>
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
								{customer.activePacks.map((p, i) => (
									<Badge key={i} variant="secondary" className="text-xs">
										{p.name}
									</Badge>
								))}
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
								<Button variant="ghost" size="sm" disabled>
									Details
									<ChevronRight className="ml-2 h-4 w-4" />
								</Button>
							</div>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>
	);
}
