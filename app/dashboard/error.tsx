"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Dashboard error boundary.
 *
 * Wraps the dashboard segment only, so a failed server action or query keeps the
 * creator in their workspace rather than falling back to the public frame. The
 * wording avoids claiming a credit or payment was applied, because a thrown
 * action never completed.
 */
export default function DashboardError({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	useEffect(() => {
		console.error("Dashboard error", {
			digest: error.digest,
			message: error.message,
		});
	}, [error]);

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
			<h1 className="text-2xl font-bold tracking-tight">
				This view could not load
			</h1>
			<p className="max-w-sm text-sm text-muted-foreground">
				Your data is unchanged. If you were in the middle of a change, it was
				not applied. Try again.
			</p>
			{error.digest && (
				<p className="font-mono text-xs text-muted-foreground">
					Reference: {error.digest}
				</p>
			)}
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Button onClick={() => retry()}>Try again</Button>
				<Button variant="outline" asChild>
					<a href="/dashboard">Reload dashboard</a>
				</Button>
			</div>
		</div>
	);
}
