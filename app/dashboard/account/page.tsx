"use client";

import { Settings } from "@/components/auth/settings/settings";
import { BillingRelationships } from "@/components/billing-relationships";

export default function AccountPage() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<h1 className="text-2xl font-bold">Account</h1>
			<p className="text-muted-foreground text-sm">
				Billing is managed per creator: each plan you buy is billed by that
				creator&apos;s Stripe account, from its own invoice history.
			</p>
			<BillingRelationships />
			<Settings view="account" />
		</div>
	);
}
