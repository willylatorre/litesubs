"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
	disconnectGoogleCalendar,
	type GoogleCalendarStatus,
	retryGoogleCalendarSync,
} from "@/app/actions/google-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

const RESULT_MESSAGES: Record<
	string,
	{ tone: "ok" | "warn" | "error"; text: string }
> = {
	connected: { tone: "ok", text: "Google Calendar connected." },
	"connected-with-warning": {
		tone: "warn",
		text: "Connected, but the first calendar read failed. Try Sync now.",
	},
	"reconnect-needed": {
		tone: "warn",
		text: "Connected without offline access. Reconnect to keep sync working.",
	},
	denied: { tone: "error", text: "Google Calendar access was denied." },
	"state-mismatch": {
		tone: "error",
		text: "That connection attempt expired. Please try again.",
	},
	"missing-config": {
		tone: "error",
		text: "Google Calendar is not configured on this server.",
	},
	"missing-key": {
		tone: "error",
		text: "Token encryption is not configured on this server, so connecting is disabled.",
	},
	"token-error": {
		tone: "error",
		text: "Google rejected the connection. Please try again.",
	},
	unauthenticated: { tone: "error", text: "Sign in to connect a calendar." },
	error: { tone: "error", text: "Google Calendar connection failed." },
};

/**
 * Format in an explicit locale and zone so the server's SSR output and the
 * browser's hydration output agree. A locale-dependent format here would cause
 * a hydration mismatch whenever the two differ.
 */
function formatSyncTime(value: Date | string | null): string | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return `${new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date)} UTC`;
}

export function GoogleCalendarCard({
	status,
	result,
}: {
	status: GoogleCalendarStatus;
	result?: string;
}) {
	const [isPending, startTransition] = useTransition();
	const router = useRouter();

	const banner = result ? RESULT_MESSAGES[result] : undefined;
	const lastSynced = formatSyncTime(status.lastSyncedAt);
	const needsRetry = Boolean(status.connected && status.syncFailure);

	const handleDisconnect = () => {
		startTransition(async () => {
			const res = await disconnectGoogleCalendar();
			if (res?.error) {
				toast.error(res.error);
				return;
			}
			toast.success(
				"Google Calendar disconnected. Existing bookings are unchanged.",
			);
			router.refresh();
		});
	};

	const handleRetry = () => {
		startTransition(async () => {
			const res = await retryGoogleCalendarSync();
			if (res?.error) {
				toast.error(res.error);
				router.refresh();
				return;
			}
			toast.success("Google Calendar sync is working again.");
			router.refresh();
		});
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div>
					<CardTitle>Google Calendar</CardTitle>
					<CardDescription>
						Optional. Busy times hide slots and your bookings appear on your
						calendar. Bookings and credits never depend on it.
					</CardDescription>
				</div>
				<Badge
					variant={
						status.connected
							? needsRetry
								? "outline"
								: "default"
							: "secondary"
					}
				>
					{status.connected
						? needsRetry
							? "Needs attention"
							: "Connected"
						: "Not connected"}
				</Badge>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{banner && (
					<p
						className={
							banner.tone === "error"
								? "text-destructive text-sm"
								: banner.tone === "warn"
									? "text-amber-600 text-sm dark:text-amber-500"
									: "text-muted-foreground text-sm"
						}
					>
						{banner.text}
					</p>
				)}

				{status.connected ? (
					<div className="flex flex-col gap-1 text-sm text-muted-foreground">
						<p>
							{status.email ? (
								<>
									Syncing{" "}
									<span className="text-foreground font-medium">
										{status.email}
									</span>
									.
								</>
							) : (
								<>
									Syncing your{" "}
									<span className="text-foreground font-medium">
										{status.calendarId ?? "primary"}
									</span>{" "}
									calendar.
								</>
							)}
						</p>
						{status.syncFailure ? (
							<p className="text-amber-600 dark:text-amber-500">
								{status.syncFailure}
							</p>
						) : lastSynced ? (
							<p>Last successful sync {lastSynced}.</p>
						) : (
							<p>No sync has completed yet.</p>
						)}
					</div>
				) : status.configured ? (
					<p className="text-muted-foreground text-sm">
						Connect to read busy times and add confirmed bookings to your
						calendar.
					</p>
				) : (
					<p className="text-muted-foreground text-sm">
						Not available on this server yet. An operator must register a Google
						OAuth client and set the calendar environment variables.
					</p>
				)}

				<div className="flex flex-wrap gap-2">
					{status.connected ? (
						<>
							{needsRetry && (
								<Button
									variant="secondary"
									disabled={isPending}
									onClick={handleRetry}
								>
									{isPending ? "Syncing..." : "Sync now"}
								</Button>
							)}
							<Button
								variant="outline"
								disabled={isPending}
								onClick={handleDisconnect}
							>
								{isPending ? "Disconnecting..." : "Disconnect"}
							</Button>
						</>
					) : status.configured ? (
						<Button asChild>
							<Link href="/api/integrations/google/oauth">
								Connect Google Calendar
							</Link>
						</Button>
					) : (
						<Button variant="outline" disabled>
							Connect Google Calendar
						</Button>
					)}
				</div>

				<p className="text-muted-foreground text-xs">
					Disconnecting stops sync only. It does not cancel bookings or change
					credits.
				</p>
			</CardContent>
		</Card>
	);
}
