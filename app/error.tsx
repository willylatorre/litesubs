"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary for the public pages (landing, auth, docs, invite,
 * pay, sample). The dashboard has its own boundary so a failed query there
 * keeps the admin chrome instead of dropping to a public shell.
 */
export default function ErrorBoundary({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	useEffect(() => {
		console.error("Public route error", {
			digest: error.digest,
			message: error.message,
		});
	}, [error]);

	return (
		<main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-2xl font-bold tracking-tight">
				Something went wrong
			</h1>
			<p className="text-sm text-muted-foreground">
				This page could not be loaded. No payment or credit change happened.
			</p>
			{error.digest && (
				<p className="font-mono text-xs text-muted-foreground">
					Reference: {error.digest}
				</p>
			)}
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Button onClick={() => retry()}>Try again</Button>
				<Button variant="outline" asChild>
					<a href="/">Back home</a>
				</Button>
			</div>
		</main>
	);
}
