"use client";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useProducts } from "@/hooks/use-products";
import { CreatePackDialog } from "./create-pack-dialog";
import { PackActions } from "./pack-actions";
import { PackDetailsDialog } from "./pack-details-dialog";

export default function PacksPage() {
	const { data: packs, isLoading, isError } = useProducts();

	if (isError) {
		return <div className="p-6 text-red-500">Failed to load plans.</div>;
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Credit Plans</h1>
					<p className="text-muted-foreground text-sm">
						Manage the credit plans you offer to your customers.
					</p>
				</div>
				<CreatePackDialog />
			</div>

			<div className="rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Price</TableHead>
							<TableHead>Credits</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: 3 }).map((_, i) => (
								<TableRow key={i}>
									<TableCell>
										<Skeleton className="h-4 w-[100px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[50px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[50px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[60px]" />
									</TableCell>
									<TableCell>
										<Skeleton className="h-4 w-[20px] ml-auto" />
									</TableCell>
								</TableRow>
							))
						) : packs?.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={5}
									className="text-center h-24 text-muted-foreground"
								>
									No plans created yet. Click "Create Plan" to get started.
								</TableCell>
							</TableRow>
						) : (
							packs?.map((pack) => (
								<TableRow key={pack.id}>
									<TableCell className="font-medium">
										<PackDetailsDialog packId={pack.id}>
											<div className="flex flex-col cursor-pointer hover:underline">
												<div className="flex items-center gap-2">
													<span>{pack.name}</span>
													{pack.integration?.calcomIntegration?.eventTypeId && (
														<Badge variant="outline">cal.com</Badge>
													)}
												</div>
												{pack.description && (
													<span className="text-xs text-muted-foreground">
														{pack.description}
													</span>
												)}
											</div>
										</PackDetailsDialog>
									</TableCell>
									<TableCell>
										{new Intl.NumberFormat("en-US", {
											style: "currency",
											currency: pack.currency
												? pack.currency.toUpperCase()
												: "USD",
										}).format(pack.price / 100)}
									</TableCell>
									<TableCell>{pack.credits}</TableCell>
									<TableCell>
										<Badge variant={pack.active ? "default" : "secondary"}>
											{pack.active ? "Active" : "Disabled"}
										</Badge>
									</TableCell>
									<TableCell className="text-right">
										<PackActions packId={pack.id} />
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
