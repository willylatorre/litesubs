"use client";

import { useState } from "react";
import { IconArrowRight, IconLink, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createConnectAccount } from "@/app/actions/stripe-connect";
import { toast } from "sonner";

interface SwitchToConnectBannerProps {
	onDismiss?: () => void;
}

export function SwitchToConnectBanner({ onDismiss }: SwitchToConnectBannerProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [isDismissed, setIsDismissed] = useState(false);

	if (isDismissed) {
		return null;
	}

	const handleConnectWithStripe = async () => {
		setIsLoading(true);
		try {
			const result = await createConnectAccount();
			if (result?.success && result.data?.url) {
				window.location.href = result.data.url;
			} else {
				toast.error(result?.error || "Failed to create Connect account");
			}
		} catch {
			toast.error("Something went wrong");
		} finally {
			setIsLoading(false);
		}
	};

	const handleDismiss = () => {
		setIsDismissed(true);
		onDismiss?.();
	};

	return (
		<Card className="border-primary/20 bg-primary/5">
			<CardContent className="flex items-center gap-4 pt-6">
				<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
					<IconLink className="h-5 w-5 text-primary" />
				</div>
				<div className="flex-1 space-y-1">
					<p className="text-sm font-medium">
						Want instant payments?
					</p>
					<p className="text-xs text-muted-foreground">
						Connect your own Stripe account and receive funds directly after
						each sale. No more waiting for manual payouts.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						onClick={handleConnectWithStripe}
						disabled={isLoading}
					>
						{isLoading ? (
							"Connecting..."
						) : (
							<>
								Connect with Stripe
								<IconArrowRight className="ml-1 h-4 w-4" />
							</>
						)}
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						onClick={handleDismiss}
					>
						<IconX className="h-4 w-4" />
						<span className="sr-only">Dismiss</span>
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
