"use client";

import {
	IconAlertCircle,
	IconBuilding,
	IconCheck,
	IconClock,
	IconExternalLink,
	IconRefresh,
	IconShieldCheck,
	IconX,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
	disconnectStripeAccount,
	refreshPaymentsStatus,
	startStripeOnboarding,
} from "@/app/actions/stripe-connect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	COMPATIBILITY_MESSAGES,
	type PaymentReadiness,
} from "@/lib/connect-copy";

const statusCopy: Record<
	PaymentReadiness["status"],
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
	}
> = {
	not_connected: { label: "Not connected", variant: "outline" },
	pending: { label: "Setup incomplete", variant: "secondary" },
	active: { label: "Ready for payments", variant: "default" },
	restricted: { label: "Needs attention", variant: "destructive" },
	disabled: { label: "Disconnected", variant: "outline" },
};

function Check({ ok }: { ok: boolean }) {
	return ok ? (
		<IconCheck className="h-4 w-4 text-green-600" />
	) : (
		<IconX className="h-4 w-4 text-destructive" />
	);
}

const connectResults: Record<string, string> = {
	complete: "Stripe account connected.",
	denied: "You cancelled the Stripe authorization. Nothing was connected.",
	invalid: "That connection request expired or was already used. Start again.",
	incompatible:
		"Stripe connected, but this account's responsibilities do not match creator-owned payments. Nothing was changed. See the details below.",
	switch_unsupported:
		"Switching to a different Stripe account is not supported while you already have customers on one. Contact support.",
	failed: "Stripe could not complete the connection. Nothing was changed.",
};

export function PaymentsSetup({
	readiness,
	connectResult,
}: {
	readiness: PaymentReadiness;
	connectResult?: string;
}) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const status = statusCopy[readiness.status];

	function onboarding() {
		startTransition(async () => {
			const result = await startStripeOnboarding();
			if (result.success && result.data?.url) {
				window.location.href = result.data.url;
				return;
			}
			toast.error(result.error ?? "Could not start onboarding");
		});
	}

	function refresh() {
		startTransition(async () => {
			const result = await refreshPaymentsStatus();
			if (result.success) {
				toast.success("Status updated from Stripe");
				router.refresh();
			} else {
				toast.error(result.error ?? "Could not refresh status");
			}
		});
	}

	function disconnect() {
		startTransition(async () => {
			const result = await disconnectStripeAccount();
			if (result.success) {
				toast.success("Stripe account disconnected");
				router.refresh();
			} else {
				toast.error(result.error ?? "Could not disconnect");
			}
		});
	}

	const needsOnboarding =
		!readiness.hasAccount ||
		!readiness.detailsSubmitted ||
		readiness.status === "restricted" ||
		readiness.status === "pending";

	const resultMessage = connectResult
		? connectResults[connectResult]
		: undefined;
	const resultIsFailure =
		connectResult !== undefined && connectResult !== "complete";

	return (
		<div className="grid gap-4 lg:grid-cols-3">
			{resultMessage && (
				<div
					className={`lg:col-span-3 flex items-start gap-2 rounded-md border p-3 text-sm ${
						resultIsFailure
							? "border-destructive/30 bg-destructive/5"
							: "border-border bg-muted/40"
					}`}
				>
					{resultIsFailure ? (
						<IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
					) : (
						<IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
					)}
					<p>{resultMessage}</p>
				</div>
			)}
			<Card className="lg:col-span-2">
				<CardHeader>
					<div className="flex items-start justify-between gap-3">
						<div className="space-y-1">
							<CardTitle className="flex items-center gap-2 text-lg">
								Stripe account
								<Badge variant={status.variant}>{status.label}</Badge>
							</CardTitle>
							<CardDescription>
								{readiness.canSell
									? "Customers can buy your published plans. Money goes to your account."
									: "New sales are blocked until Stripe confirms this account can accept payments."}
							</CardDescription>
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={refresh}
							disabled={pending || !readiness.hasAccount}
							aria-label="Refresh status from Stripe"
						>
							<IconRefresh
								className={`h-4 w-4 ${pending ? "animate-spin" : ""}`}
							/>
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-2 text-sm">
						{[
							["Accepts payments", readiness.chargesEnabled],
							["Payouts enabled", readiness.payoutsEnabled],
							["Details submitted", readiness.detailsSubmitted],
						].map(([label, ok]) => (
							<div
								key={String(label)}
								className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2"
							>
								<span className="text-muted-foreground">{label}</span>
								<span className="flex items-center gap-1.5 font-medium">
									<Check ok={Boolean(ok)} />
									{ok ? "Yes" : "No"}
								</span>
							</div>
						))}
						{readiness.country && (
							<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
								<span className="text-muted-foreground">Country</span>
								<span className="font-medium uppercase">
									{readiness.country}
								</span>
							</div>
						)}
					</div>

					{readiness.needsAttention && readiness.hasAccount && (
						<div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
							<IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
							<div className="space-y-1">
								<p className="font-medium">Stripe needs more information</p>
								{readiness.disabledReason && (
									<p className="font-mono text-xs text-muted-foreground">
										{readiness.disabledReason}
									</p>
								)}
								{readiness.requirementsDue.length > 0 && (
									<p className="text-xs text-muted-foreground">
										{readiness.requirementsDue.length} requirement
										{readiness.requirementsDue.length === 1 ? "" : "s"} to
										resolve. Continue setup to fix them in Stripe&apos;s hosted
										form.
									</p>
								)}
							</div>
						</div>
					)}

					{readiness.hasAccount && !readiness.compatible && (
						<div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
							<IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
							<div className="space-y-1">
								<p className="font-medium">
									This account is not configured for creator-owned payments
								</p>
								<ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
									{readiness.compatibilityIssues.map((issue) => (
										<li key={issue}>{COMPATIBILITY_MESSAGES[issue]}</li>
									))}
								</ul>
								<p className="text-xs text-muted-foreground">
									Litesubs will not change these settings for you, and will not
									sell on an account with a different agreement.
								</p>
							</div>
						</div>
					)}

					<div className="flex flex-wrap gap-2">
						{needsOnboarding && (
							<Button onClick={onboarding} disabled={pending}>
								<IconClock className="mr-2 h-4 w-4" />
								{readiness.hasAccount ? "Continue setup" : "Set up payments"}
							</Button>
						)}
						{readiness.dashboardUrl && (
							<Button asChild variant="outline">
								<a
									href={readiness.dashboardUrl}
									target="_blank"
									rel="noreferrer"
								>
									Open Stripe Dashboard
									<IconExternalLink className="ml-2 h-4 w-4" />
								</a>
							</Button>
						)}
						{!readiness.hasAccount && readiness.existingAccountAvailable && (
							<Button asChild variant="outline">
								<a href="/api/connect/oauth/start">
									<IconBuilding className="mr-2 h-4 w-4" />
									Connect an existing Stripe account
								</a>
							</Button>
						)}
						{readiness.hasAccount && (
							<Button
								variant="ghost"
								onClick={disconnect}
								disabled={pending}
								className="text-muted-foreground"
							>
								Disconnect
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<IconShieldCheck className="h-4 w-4" />
						Who is responsible
					</CardTitle>
					<CardDescription>
						These responsibilities are part of the account configuration.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					<p>{readiness.responsibilities.dashboard}</p>
					<p>{readiness.responsibilities.fees}</p>
					<p>{readiness.responsibilities.losses}</p>
					{readiness.lastSyncedAt && (
						<p className="text-xs text-muted-foreground">
							Last checked {new Date(readiness.lastSyncedAt).toLocaleString()}
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
