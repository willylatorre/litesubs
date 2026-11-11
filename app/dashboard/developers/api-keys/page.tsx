"use client";

import { ApiKeysCard } from "@daveyplate/better-auth-ui";
import Link from "next/link";

export default function ApiTokensPage() {
	return (
		<div className="max-w-3xl space-y-6 px-4 py-6 lg:px-6">
			<header className="space-y-2">
				<h1 className="text-2xl font-bold tracking-tight">API tokens</h1>
				<p className="text-muted-foreground">
					Generate and revoke tokens for credit consumption from your backend.
				</p>
			</header>
			<p className="text-sm">
				Send a token in the <code>x-api-key</code> header. Each token can only
				consume your customers’ credits. It cannot grant credits, change plans,
				or read billing history.
			</p>
			<ApiKeysCard />
			<p className="text-sm text-muted-foreground">
				New tokens are shown once. Store them securely and never embed them in a
				public frontend. Revoke any token that may have been exposed.
			</p>
			<Link
				href="/docs#credits"
				className="text-sm underline underline-offset-4"
			>
				See consumption examples and retry rules
			</Link>
		</div>
	);
}
