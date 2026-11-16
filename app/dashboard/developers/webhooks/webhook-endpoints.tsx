"use client";

import { useRouter } from "next/navigation";
import { useCallback, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	createWebhookEndpoint,
	deleteWebhookEndpoint,
	sendWebhookTestEvent,
	updateWebhookEndpoint,
} from "@/app/actions/webhooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	WEBHOOK_EVENT_LABELS,
	WEBHOOK_EVENT_TYPES,
	type WebhookEventType,
} from "@/lib/webhook-events";

export type EndpointRow = {
	id: string;
	name: string;
	url: string;
	events: WebhookEventType[];
	active: boolean;
	createdAt: Date | string;
};

function eventLabel(type: WebhookEventType) {
	return type;
}

export function WebhookEndpoints({
	initialEndpoints,
	error,
}: {
	initialEndpoints: EndpointRow[];
	error?: string;
}) {
	const router = useRouter();
	const [endpoints, setEndpoints] = useState<EndpointRow[]>(initialEndpoints);
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [events, setEvents] = useState<WebhookEventType[]>([
		"purchase.completed",
	]);
	const [signingSecret, setSigningSecret] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const nameId = useId();
	const urlId = useId();

	const refresh = useCallback(() => router.refresh(), [router]);

	function toggleEvent(type: WebhookEventType) {
		setEvents((current) =>
			current.includes(type)
				? current.filter((value) => value !== type)
				: [...current, type],
		);
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		if (events.length === 0) {
			toast.error("Choose at least one event");
			return;
		}
		startTransition(async () => {
			const result = await createWebhookEndpoint({ name, url, events });
			if (result.error || !result.data) {
				toast.error(result.error ?? "Could not create the endpoint");
				return;
			}
			setEndpoints((current) => [result.data as EndpointRow, ...current]);
			setSigningSecret(result.data.signingSecret);
			setOpen(false);
			setName("");
			setUrl("");
			setEvents(["purchase.completed"]);
			refresh();
		});
	}

	function toggleActive(endpoint: EndpointRow) {
		startTransition(async () => {
			const result = await updateWebhookEndpoint({
				id: endpoint.id,
				active: !endpoint.active,
			});
			if (result.error) {
				toast.error(result.error);
				return;
			}
			setEndpoints((current) =>
				current.map((row) =>
					row.id === endpoint.id ? { ...row, active: !row.active } : row,
				),
			);
			refresh();
		});
	}

	function remove(endpoint: EndpointRow) {
		startTransition(async () => {
			const result = await deleteWebhookEndpoint(endpoint.id);
			if (result.error) {
				toast.error(result.error);
				return;
			}
			setEndpoints((current) =>
				current.filter((row) => row.id !== endpoint.id),
			);
			toast.success("Endpoint deleted");
			refresh();
		});
	}

	function sendTest(endpoint: EndpointRow) {
		startTransition(async () => {
			const result = await sendWebhookTestEvent(endpoint.id);
			if (result.error) {
				toast.error(result.error);
				return;
			}
			toast.success("Test event sent — check recent deliveries");
			refresh();
		});
	}

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-lg font-semibold">Endpoints</h2>
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button>Add endpoint</Button>
					</DialogTrigger>
					<DialogContent className="sm:max-w-[480px]">
						<form onSubmit={submit}>
							<DialogHeader>
								<DialogTitle>Add a webhook endpoint</DialogTitle>
								<DialogDescription>
									We POST a signed JSON event to this URL. The signing secret is
									shown once, right after you create it.
								</DialogDescription>
							</DialogHeader>
							<div className="grid gap-4 py-4">
								<div className="grid gap-2">
									<Label htmlFor={nameId}>Name</Label>
									<Input
										id={nameId}
										value={name}
										onChange={(event) => setName(event.target.value)}
										placeholder="e.g. App backend"
										required
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor={urlId}>Endpoint URL</Label>
									<Input
										id={urlId}
										type="url"
										value={url}
										onChange={(event) => setUrl(event.target.value)}
										placeholder="https://example.com/litesubs/webhook"
										required
									/>
									<p className="text-xs text-muted-foreground">
										HTTPS only. Redirects are treated as failures so a signed
										payload is never forwarded elsewhere.
									</p>
								</div>
								<div className="grid gap-2">
									<Label>Events</Label>
									{WEBHOOK_EVENT_TYPES.map((type) => (
										<label
											key={type}
											htmlFor={`event-${type}`}
											className="flex items-start gap-2 text-sm"
										>
											<Checkbox
												id={`event-${type}`}
												checked={events.includes(type)}
												onCheckedChange={() => toggleEvent(type)}
												className="mt-0.5"
											/>
											<span>
												<code className="text-xs">{eventLabel(type)}</code>
												<span className="block text-xs text-muted-foreground">
													{WEBHOOK_EVENT_LABELS[type]}
												</span>
											</span>
										</label>
									))}
								</div>
							</div>
							<DialogFooter>
								<Button
									type="button"
									variant="ghost"
									onClick={() => setOpen(false)}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={isPending}>
									{isPending ? "Creating..." : "Create endpoint"}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{error && <p className="text-sm text-destructive">{error}</p>}

			{signingSecret && (
				<div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
					<h3 className="text-sm font-semibold">
						Copy this signing secret now
					</h3>
					<p className="text-xs text-muted-foreground">
						It is used to verify the{" "}
						<code className="rounded bg-muted px-1 py-0.5">
							X-Litesubs-Signature
						</code>{" "}
						header and is never shown again.
					</p>
					<code className="block break-all rounded bg-muted p-2 text-xs">
						{signingSecret}
					</code>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => {
							void navigator.clipboard?.writeText(signingSecret);
							toast.success("Secret copied");
						}}
					>
						Copy
					</Button>
				</div>
			)}

			{endpoints.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>No endpoints yet</EmptyTitle>
						<EmptyDescription>
							Add one to start receiving purchase and balance events.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>URL</TableHead>
								<TableHead>Events</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{endpoints.map((endpoint) => (
								<TableRow key={endpoint.id}>
									<TableCell className="font-medium">{endpoint.name}</TableCell>
									<TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
										{endpoint.url}
									</TableCell>
									<TableCell className="text-xs">
										{endpoint.events.join(", ")}
									</TableCell>
									<TableCell>
										<Badge variant={endpoint.active ? "default" : "secondary"}>
											{endpoint.active ? "Active" : "Disabled"}
										</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												disabled={isPending}
												onClick={() => sendTest(endpoint)}
											>
												Send test
											</Button>
											<Button
												variant="ghost"
												size="sm"
												disabled={isPending}
												onClick={() => toggleActive(endpoint)}
											>
												{endpoint.active ? "Disable" : "Enable"}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												disabled={isPending}
												onClick={() => remove(endpoint)}
											>
												Delete
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</section>
	);
}
