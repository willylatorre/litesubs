"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { disconnectCalAccount } from "@/app/actions/cal-com";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type CalIntegrationStatus = {
	connected: boolean;
	username?: string | null;
};

export function CalIntegrationCard({ status }: { status: CalIntegrationStatus }) {
	const [isPending, startTransition] = useTransition();
	const router = useRouter();

	const handleDisconnect = () => {
		startTransition(async () => {
			const result = await disconnectCalAccount();
			if (result?.error) {
				toast.error(result.error);
				return;
			}
			toast.success("Cal.com disconnected");
			router.refresh();
		});
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div>
					<CardTitle>Cal.com</CardTitle>
					<CardDescription>
						Connect your Cal.com account to attach event types to plans.
					</CardDescription>
				</div>
				<Badge variant={status.connected ? "default" : "secondary"}>
					{status.connected ? "Connected" : "Not connected"}
				</Badge>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{status.connected && status.username && (
					<p className="text-sm text-muted-foreground">
						Signed in as <span className="font-medium">{status.username}</span>.
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{status.connected ? (
						<Button
							variant="outline"
							disabled={isPending}
							onClick={handleDisconnect}
						>
							{isPending ? "Disconnecting..." : "Disconnect"}
						</Button>
					) : (
						<Button asChild>
							<Link href="/api/integrations/cal/oauth">Connect Cal.com</Link>
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
