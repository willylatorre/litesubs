"use client";

import {
	ApiKeysCard,
	ChangePasswordCard,
	DeleteAccountCard,
	SessionsCard,
	TwoFactorCard,
	UpdateNameCard,
} from "@daveyplate/better-auth-ui";

export default function AccountPage() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<h1 className="text-2xl font-bold">Account</h1>
			<p className="text-muted-foreground text-sm">
				Billing is managed per creator: each plan you buy is billed by that
				creator&apos;s Stripe account, from its own invoice history.
			</p>
			<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
				<div className="space-y-6">
					<UpdateNameCard />
					<ChangePasswordCard />
					<ApiKeysCard />
				</div>
				<div className="space-y-6">
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
