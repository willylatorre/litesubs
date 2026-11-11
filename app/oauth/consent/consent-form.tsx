"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { submitConsent } from "./actions";

export function ConsentForm({ query }: { query: string }) {
	const [state, action, pending] = useActionState(submitConsent, {});
	return (
		<form action={action} className="space-y-4">
			<input type="hidden" name="oauth_query" value={query} />
			{state.error ? (
				<p role="alert" className="text-sm text-destructive">
					{state.error}
				</p>
			) : null}
			<div className="flex flex-wrap gap-3">
				<Button
					type="submit"
					name="accept"
					value="false"
					variant="outline"
					disabled={pending}
				>
					Deny access
				</Button>
				<Button type="submit" name="accept" value="true" disabled={pending}>
					{pending ? "Submitting…" : "Allow access"}
				</Button>
			</div>
		</form>
	);
}
