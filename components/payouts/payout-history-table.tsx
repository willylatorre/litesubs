import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface PayoutHistoryTableProps {
	history: any[];
}

export function PayoutHistoryTable({ history }: PayoutHistoryTableProps) {
	if (!history || history.length === 0) {
		return (
			<div className="text-center p-8 text-muted-foreground border rounded-md">
				No payout history yet.
			</div>
		);
	}

	const getStatusColor = (status: string) => {
		switch (status) {
			case "completed":
				return "default"; // or green-ish if custom theme
			case "pending":
			case "processing":
				return "secondary";
			case "failed":
			case "cancelled":
				return "destructive";
			default:
				return "outline";
		}
	};

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Date</TableHead>
						<TableHead>Amount</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Transaction ID</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{history.map((payout) => (
						<TableRow key={payout.id}>
							<TableCell>
								{format(new Date(payout.createdAt), "MMM d, yyyy")}
							</TableCell>
							<TableCell>${payout.amount}</TableCell>
							<TableCell>
								<Badge variant={getStatusColor(payout.status)}>
									{payout.status}
								</Badge>
							</TableCell>
							<TableCell className="text-right font-mono text-xs">
								{payout.id.slice(0, 8)}...
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
