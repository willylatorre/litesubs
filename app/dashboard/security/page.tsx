"use client";

import { Settings } from "@/components/auth/settings/settings";

export default function SecurityPage() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<h1 className="text-2xl font-bold">Security</h1>
			<p className="text-muted-foreground text-sm">
				Manage your password, connected accounts and active sessions.
			</p>
			<Settings view="security" />
		</div>
	);
}
