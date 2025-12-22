import { getCreatorCustomers } from "@/app/actions/customers";
import { getUserPendingInvites } from "@/app/actions/invites";
import { InviteItem } from "@/components/invite-item";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ManageCreditsDialog } from "./manage-credits-dialog";

export default async function CustomersPage() {
	const [customers, pendingInvites] = await Promise.all([
		getCreatorCustomers(),
		getUserPendingInvites(),
	]);

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

			{pendingInvites.length > 0 && (
				<div className="space-y-4">
					<h2 className="text-lg font-semibold">Pending Invites</h2>
					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						{pendingInvites.map((invite) => (
							<InviteItem key={invite.id} invite={invite} />
						))}
					</div>
				</div>
			)}

			<div className="rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Customer</TableHead>
							<TableHead>Current Credits</TableHead>
							<TableHead>Last Updated</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{customers.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={4}
									className="text-center h-24 text-muted-foreground"
								>
									No customers found. Share your packs to get started!
								</TableCell>
							</TableRow>
						) : (
							customers.map((record) => (
								<TableRow key={record.id}>
									<TableCell className="font-medium">
										<div className="flex items-center gap-3">
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
									</TableCell>
									<TableCell className="font-mono text-lg">
										{record.credits}
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										{new Date(record.updatedAt).toLocaleDateString()}
									</TableCell>
									<TableCell className="text-right">
										<ManageCreditsDialog
											userId={record.userId}
											customerName={record.user.name}
											currentCredits={record.credits}
										/>
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
