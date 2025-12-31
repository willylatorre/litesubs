import { getCreatorCustomers } from "@/app/actions/customers";
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
import { ChevronRight } from "lucide-react";
import { CustomerDetailsDialog } from "./customer-details-dialog";
import { Badge } from "@/components/ui/badge";
import { DecreaseCreditButton } from "./decrease-credit-button";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
	const customers = await getCreatorCustomers();

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Customers</h1>
					<p className="text-muted-foreground text-sm">
						View and manage your customers and their credit balances.
					</p>
				</div>
			</div>

			<div className="rounded-md border bg-card">
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
						{customers.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={5}
									className="text-center h-24 text-muted-foreground"
								>
									No customers found. Share your plans to get started!
								</TableCell>
							</TableRow>
						) : (
							customers.map((record) => (
								<TableRow key={record.id}>
									<TableCell className="font-medium">
										<CustomerDetailsDialog
											customerId={record.userId}
											customer={{
												name: record.user.name,
												email: record.user.email,
												image: record.user.image,
											}}
											initialSubscriptions={record.activePacks}
										>
											<div className="flex items-center gap-3 cursor-pointer hover:underline">
												<Avatar className="h-8 w-8">
													<AvatarImage
														src={record.user.image || ""}
														alt={record.user.name}
													/>
													<AvatarFallback>
														{record.user.name.substring(0, 2).toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div className="flex flex-col">
													<span>{record.user.name}</span>
													<span className="text-xs text-muted-foreground">
														{record.user.email}
													</span>
												</div>
											</div>
										</CustomerDetailsDialog>
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											{record.activePacks.length > 0 ? (
												record.activePacks.map((pack) => (
													<Badge
														key={pack.id}
														variant="secondary"
														className="text-xs"
													>
														{pack.name}
													</Badge>
												))
											) : (
												<span className="text-muted-foreground text-xs">
													-
												</span>
											)}
										</div>
									</TableCell>
									<TableCell className="font-mono text-lg">
										{record.credits}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{new Date(record.updatedAt).toLocaleDateString()}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-2">
											{record.activePacks.length === 1 && (
												<DecreaseCreditButton
													subscriptionId={record.activePacks[0].subscriptionId}
													currentCredits={record.activePacks[0].credits}
													variant="outline"
													size="sm"
												/>
											)}
											<CustomerDetailsDialog
												customerId={record.userId}
												customer={{
													name: record.user.name,
													email: record.user.email,
													image: record.user.image,
												}}
												initialSubscriptions={record.activePacks}
											>
												<Button variant="ghost" size="sm">
													Details
													<ChevronRight className="ml-2 h-4 w-4" />
												</Button>
											</CustomerDetailsDialog>
										</div>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
