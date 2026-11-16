"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { retryWebhookDelivery } from "@/app/actions/webhooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export type DeliveryRow = {
	id: string;
	eventId: string;
	eventType: string;
	status: "pending" | "succeeded" | "failed";
	attempts: number;
	responseStatus: number | null;
	lastError: string | null;
	lastAttemptedAt: Date | string | null;
	createdAt: Date | string;
	endpoint?: { id: string; name: string; url: string; active: boolean } | null;
};

function statusVariant(status: DeliveryRow["status"]) {
	if (status === "succeeded") return "default" as const;
	if (status === "failed") return "destructive" as const;
	return "secondary" as const;
}

function formatWhen(value: Date | string | null) {
	if (!value) return "—";
	return new Date(value).toLocaleString();
}

export function WebhookDeliveries({
	initialDeliveries,
	error,
}: {
	initialDeliveries: DeliveryRow[];
	error?: string;
}) {
	const router = useRouter();
	const [deliveries, setDeliveries] =
		useState<DeliveryRow[]>(initialDeliveries);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	function retry(delivery: DeliveryRow) {
		setPendingId(delivery.id);
		startTransition(async () => {
			const result = await retryWebhookDelivery(delivery.id);
			setPendingId(null);
			if (result.error) {
				toast.error(result.error);
				return;
			}
			const succeeded = result.data?.succeeded ?? false;
			setDeliveries((current) =>
				current.map((row) =>
					row.id === delivery.id
						? {
								...row,
								status: succeeded ? "succeeded" : "failed",
								attempts: row.attempts + 1,
								responseStatus: result.data?.responseStatus ?? null,
								lastError: result.data?.error ?? null,
								lastAttemptedAt: new Date(),
							}
						: row,
				),
			);
			if (succeeded) toast.success("Delivery succeeded");
			else toast.error("Delivery failed again — see the last error");
			router.refresh();
		});
	}

	const failures = deliveries.filter((row) => row.status === "failed").length;

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-lg font-semibold">Recent deliveries</h2>
				{failures > 0 && (
					<Badge variant="destructive">{failures} failing in this view</Badge>
				)}
			</div>

			{error && <p className="text-sm text-destructive">{error}</p>}

			{deliveries.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>Nothing delivered yet</EmptyTitle>
						<EmptyDescription>
							Deliveries appear here as soon as a subscribed event happens. Use
							“Send test” on an endpoint to check the wiring.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Event</TableHead>
								<TableHead>Endpoint</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Attempts</TableHead>
								<TableHead>Last attempt</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{deliveries.map((delivery) => (
								<TableRow key={delivery.id}>
									<TableCell>
										<div className="text-xs font-medium">
											{delivery.eventType}
										</div>
										<div className="max-w-[200px] truncate text-[11px] text-muted-foreground">
											{delivery.eventId}
										</div>
									</TableCell>
									<TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
										{delivery.endpoint?.name ?? "—"}
									</TableCell>
									<TableCell>
										<Badge variant={statusVariant(delivery.status)}>
											{delivery.status}
										</Badge>
										{delivery.lastError && (
											<p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
												{delivery.lastError}
												{delivery.responseStatus
													? ` (HTTP ${delivery.responseStatus})`
													: ""}
											</p>
										)}
									</TableCell>
									<TableCell className="tabular-nums text-xs">
										{delivery.attempts}
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{formatWhen(delivery.lastAttemptedAt)}
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="sm"
											disabled={
												isPending ||
												pendingId === delivery.id ||
												delivery.status === "succeeded"
											}
											onClick={() => retry(delivery)}
										>
											{pendingId === delivery.id ? "Sending..." : "Re-send"}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<p className="text-xs text-muted-foreground">
				A re-send keeps the original event id and payload, so your receiver can
				dedupe it as the same event rather than a new one.
			</p>
		</section>
	);
}
