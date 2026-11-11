import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getCreatorCustomers } from "@/app/actions/customers";
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
import { isSampleCustomerId } from "@/lib/sample-data";
import { CustomerDetailsDialog } from "./customer-details-dialog";
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
								<TableCell colSpan={5} className="h-32 text-center">
									<div className="flex flex-col items-center gap-2">
										<p className="text-muted-foreground">
											No customers yet. After you create a plan, invite a
											customer or share a checkout link and their balance
											appears here.
										</p>
										<p className="text-sm text-muted-foreground">
											New here?{" "}
											<Link
												href="/dashboard/creator"
												className="underline underline-offset-4"
											>
												Load a sample customer
											</Link>{" "}
											to see a filled-in ledger.
										</p>
									</div>
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
											initialEnrollments={record.enrollments}
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
													<span className="flex items-center gap-2">
														{record.user.name}
														{isSampleCustomerId(record.userId) && (
															<Badge variant="outline">Sample</Badge>
														)}
													</span>
													<span className="text-xs text-muted-foreground">
														{record.user.email}
													</span>
												</div>
											</div>
										</CustomerDetailsDialog>
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											{record.enrollments.length > 0 ? (
												record.enrollments.map((plan) => (
													<Badge
														key={plan.id}
														variant="secondary"
														className="text-xs"
													>
														{plan.name}
													</Badge>
												))
											) : (
												<span className="text-muted-foreground text-xs">-</span>
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
											{record.enrollments.length === 1 && (
												<DecreaseCreditButton
													enrollmentId={record.enrollments[0].enrollmentId}
													currentCredits={record.enrollments[0].credits}
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
												initialEnrollments={record.enrollments}
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
