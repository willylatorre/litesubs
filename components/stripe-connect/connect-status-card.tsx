"use client";

import { useState } from "react";
import {
	IconAlertCircle,
	IconCheck,
	IconClock,
	IconExternalLink,
	IconRefresh,
	IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
	createConnectAccountLink,
	getConnectDashboardLink,
	syncConnectAccountStatus,
} from "@/app/actions/stripe-connect";
import type { StripeConnectStatus } from "@/app/db/stripe-connect-schema";
import { toast } from "sonner";

interface ConnectStatusCardProps {
	status: StripeConnectStatus;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	detailsSubmitted: boolean;
	country?: string | null;
	defaultCurrency?: string | null;
	onStatusUpdated?: () => void;
}

const statusConfig: Record<
	StripeConnectStatus,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
		icon: typeof IconCheck;
		description: string;
	}
> = {
	pending: {
		label: "Pending",
		variant: "secondary",
		icon: IconClock,
		description:
			"Complete your Stripe onboarding to start receiving payments directly.",
	},
	active: {
		label: "Active",
		variant: "default",
		icon: IconCheck,
		description:
			"Your Stripe Connect account is fully set up. Payments go directly to your account.",
	},
	restricted: {
		label: "Restricted",
		variant: "destructive",
		icon: IconAlertCircle,
		description:
			"Your account has restrictions. Please update your information in Stripe.",
	},
	disabled: {
		label: "Disabled",
		variant: "outline",
		icon: IconX,
		description: "Your Stripe Connect account has been disabled.",
	},
};

export function ConnectStatusCard({
	status,
	chargesEnabled,
	payoutsEnabled,
	detailsSubmitted,
	country,
	defaultCurrency,
	onStatusUpdated,
}: ConnectStatusCardProps) {
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isOpeningDashboard, setIsOpeningDashboard] = useState(false);
	const [isOnboarding, setIsOnboarding] = useState(false);

	const config = statusConfig[status];
	const StatusIcon = config.icon;

	const handleRefreshStatus = async () => {
		setIsRefreshing(true);
		try {
			const result = await syncConnectAccountStatus();
			if (result?.success) {
				toast.success("Status updated");
				onStatusUpdated?.();
			} else {
				toast.error(result?.error || "Failed to refresh status");
			}
		} catch {
			toast.error("Something went wrong");
		} finally {
			setIsRefreshing(false);
		}
	};

	const handleOpenDashboard = async () => {
		setIsOpeningDashboard(true);
		try {
			const result = await getConnectDashboardLink();
			if (result?.success && result.data?.url) {
				window.open(result.data.url, "_blank");
			} else {
				toast.error(result?.error || "Failed to open dashboard");
			}
		} catch {
			toast.error("Something went wrong");
		} finally {
			setIsOpeningDashboard(false);
		}
	};

	const handleContinueOnboarding = async () => {
		setIsOnboarding(true);
		try {
			const result = await createConnectAccountLink();
			if (result?.success && result.data?.url) {
				window.location.href = result.data.url;
			} else {
				toast.error(result?.error || "Failed to create onboarding link");
			}
		} catch {
			toast.error("Something went wrong");
		} finally {
			setIsOnboarding(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div className="space-y-1">
						<CardTitle className="flex items-center gap-2 text-lg">
							Stripe Connect Status
							<Badge variant={config.variant} className="ml-2">
								<StatusIcon className="mr-1 h-3 w-3" />
								{config.label}
							</Badge>
						</CardTitle>
						<CardDescription>{config.description}</CardDescription>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRefreshStatus}
						disabled={isRefreshing}
					>
						<IconRefresh
							className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
						/>
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Status Details */}
				<div className="grid gap-3 text-sm">
					<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
						<span className="text-muted-foreground">Charges Enabled</span>
						<span className="flex items-center gap-1 font-medium">
							{chargesEnabled ? (
								<>
									<IconCheck className="h-4 w-4 text-green-500" />
									Yes
								</>
							) : (
								<>
									<IconX className="h-4 w-4 text-destructive" />
									No
								</>
							)}
						</span>
					</div>
					<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
						<span className="text-muted-foreground">Payouts Enabled</span>
						<span className="flex items-center gap-1 font-medium">
							{payoutsEnabled ? (
								<>
									<IconCheck className="h-4 w-4 text-green-500" />
									Yes
								</>
							) : (
								<>
									<IconX className="h-4 w-4 text-destructive" />
									No
								</>
							)}
						</span>
					</div>
					<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
						<span className="text-muted-foreground">Details Submitted</span>
						<span className="flex items-center gap-1 font-medium">
							{detailsSubmitted ? (
								<>
									<IconCheck className="h-4 w-4 text-green-500" />
									Yes
								</>
							) : (
								<>
									<IconX className="h-4 w-4 text-destructive" />
									No
								</>
							)}
						</span>
					</div>
					{country && (
						<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
							<span className="text-muted-foreground">Country</span>
							<span className="font-medium">{country.toUpperCase()}</span>
						</div>
					)}
					{defaultCurrency && (
						<div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
							<span className="text-muted-foreground">Default Currency</span>
							<span className="font-medium uppercase">{defaultCurrency}</span>
						</div>
					)}
				</div>

				{/* Action Buttons */}
				<div className="flex flex-wrap gap-2">
					{status === "active" && (
						<Button onClick={handleOpenDashboard} disabled={isOpeningDashboard}>
							{isOpeningDashboard ? (
								"Opening..."
							) : (
								<>
									Open Stripe Dashboard
									<IconExternalLink className="ml-2 h-4 w-4" />
								</>
							)}
						</Button>
					)}

					{(status === "pending" || status === "restricted") && (
						<Button onClick={handleContinueOnboarding} disabled={isOnboarding}>
							{isOnboarding
								? "Redirecting..."
								: status === "pending"
									? "Continue Setup"
									: "Update Information"}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
