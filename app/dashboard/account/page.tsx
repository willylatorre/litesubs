"use client";

import {
	ChangePasswordCard,
	DeleteAccountCard,
	SessionsCard,
	TwoFactorCard,
	UpdateNameCard,
} from "@daveyplate/better-auth-ui";
import { CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { createCustomerPortalSession } from "@/app/actions/stripe";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export default function AccountPage() {
	const [isLoadingPortal, setIsLoadingPortal] = useState(false);

	const handleManageBilling = async () => {
		setIsLoadingPortal(true);
		try {
			await createCustomerPortalSession();
		} catch (error) {
			console.error(error);
			toast.error("Failed to open billing portal");
		} finally {
			setIsLoadingPortal(false);
		}
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<h1 className="text-2xl font-bold">Account & Billing</h1>
			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				<div className="space-y-6">
					<UpdateNameCard />
					<ChangePasswordCard />
				</div>
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Billing</CardTitle>
							<CardDescription>
								Manage your billing information and view invoices.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Button
								className="w-full"
								onClick={handleManageBilling}
								disabled={isLoadingPortal}
							>
								{isLoadingPortal ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<CreditCard className="mr-2 h-4 w-4" />
								)}
								Manage Billing
							</Button>
						</CardContent>
					</Card>
					<TwoFactorCard />
				</div>
				<div className="space-y-6">
					<SessionsCard />
					<DeleteAccountCard />
				</div>
			</div>
		</div>
	);
}
