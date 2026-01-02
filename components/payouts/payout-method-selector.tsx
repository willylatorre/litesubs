"use client";

import { useState } from "react";
import { IconArrowRight, IconBuildingBank, IconLink } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { setPayoutPreference } from "@/app/actions/payout-preferences";
import { createConnectAccount } from "@/app/actions/stripe-connect";
import { toast } from "sonner";

interface PayoutMethodSelectorProps {
	onMethodSelected?: () => void;
}

export function PayoutMethodSelector({
	onMethodSelected,
}: PayoutMethodSelectorProps) {
	const [isConnectLoading, setIsConnectLoading] = useState(false);
	const [isPlatformLoading, setIsPlatformLoading] = useState(false);

	const handleConnectWithStripe = async () => {
		setIsConnectLoading(true);
		try {
			const result = await createConnectAccount();
			if (result?.success && result.data?.url) {
				// Redirect to Stripe onboarding
				window.location.href = result.data.url;
			} else {
				toast.error(result?.error || "Failed to create Connect account");
			}
		} catch {
			toast.error("Something went wrong");
		} finally {
			setIsConnectLoading(false);
		}
	};

	const handleUsePlatformPayouts = async () => {
		setIsPlatformLoading(true);
		try {
			const result = await setPayoutPreference("platform_payouts");
			if (result?.success) {
				toast.success("Platform payouts enabled");
				onMethodSelected?.();
			} else {
				toast.error("Failed to set payout preference");
			}
		} catch {
			toast.error("Something went wrong");
		} finally {
			setIsPlatformLoading(false);
		}
	};

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Choose Your Payout Method</CardTitle>
				<CardDescription>
					Select how you&apos;d like to receive payments from your sales
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4 md:grid-cols-2">
					{/* Stripe Connect Option */}
					<Card className="relative overflow-hidden border-2 transition-colors hover:border-primary/50">
						<div className="absolute right-2 top-2">
							<span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
								Recommended
							</span>
						</div>
						<CardHeader className="pt-8">
							<div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
								<IconLink className="h-6 w-6 text-primary" />
							</div>
							<CardTitle className="text-lg">Stripe Connect</CardTitle>
							<CardDescription>
								Receive payments directly to your Stripe account
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<ul className="space-y-2 text-sm text-muted-foreground">
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
									<span>
										<strong className="text-foreground">Instant payments</strong>{" "}
										— receive funds directly after each sale
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
									<span>
										<strong className="text-foreground">Your Stripe dashboard</strong>{" "}
										— full visibility into your transactions
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
									<span>
										<strong className="text-foreground">Direct bank deposits</strong>{" "}
										— payouts go straight to your bank
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
									<span>
										<strong className="text-foreground">You&apos;re in control</strong>{" "}
										— manage your own Stripe account settings
									</span>
								</li>
							</ul>
							<Button
								className="w-full"
								onClick={handleConnectWithStripe}
								disabled={isConnectLoading}
							>
								{isConnectLoading ? (
									"Connecting..."
								) : (
									<>
										Connect with Stripe
										<IconArrowRight className="ml-2 h-4 w-4" />
									</>
								)}
							</Button>
						</CardContent>
					</Card>

					{/* Platform Payouts Option */}
					<Card className="border-2 transition-colors hover:border-muted-foreground/50">
						<CardHeader className="pt-8">
							<div className="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
								<IconBuildingBank className="h-6 w-6 text-muted-foreground" />
							</div>
							<CardTitle className="text-lg">Platform Payouts</CardTitle>
							<CardDescription>
								We handle payments and you request payouts
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<ul className="space-y-2 text-sm text-muted-foreground">
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
									<span>
										<strong className="text-foreground">No Stripe account needed</strong>{" "}
										— we handle all the payment infrastructure
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
									<span>
										<strong className="text-foreground">Simple & straightforward</strong>{" "}
										— just request a payout when you&apos;re ready
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
									<span>
										<strong className="text-foreground">$50 minimum threshold</strong>{" "}
										— request payouts when you reach the minimum
									</span>
								</li>
								<li className="flex items-start gap-2">
									<span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
									<span>
										<strong className="text-foreground">We handle compliance</strong>{" "}
										— no need to worry about Stripe account setup
									</span>
								</li>
							</ul>
							<Button
								variant="outline"
								className="w-full"
								onClick={handleUsePlatformPayouts}
								disabled={isPlatformLoading}
							>
								{isPlatformLoading ? (
									"Setting up..."
								) : (
									<>
										Use Platform Payouts
										<IconArrowRight className="ml-2 h-4 w-4" />
									</>
								)}
							</Button>
						</CardContent>
					</Card>
				</div>

				<p className="mt-4 text-center text-xs text-muted-foreground">
					Both options include a 10% platform fee. You can change your preference later.
				</p>
			</CardContent>
		</Card>
	);
}
