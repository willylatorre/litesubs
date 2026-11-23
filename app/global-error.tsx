"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Root error boundary.
 *
 * Without this file Next generates a bare document for `/_global-error`, so a
 * render failure anywhere in the tree had no product UI and no way back. This
 * replaces the root layout, which is why it must render its own document.
 *
 * The app's theme class lives on `<html>` in the root layout, so it is repeated
 * here (as the Next docs require) to keep the page in the same visual family.
 */
export default function GlobalError({
	error,
	retry,
}: {
	error: Error & { digest?: string };
	retry: () => void;
}) {
	useEffect(() => {
		// The digest is the only safe correlation id for a production error.
		console.error("Unhandled application error", {
			digest: error.digest,
			message: error.message,
		});
	}, [error]);

	return (
		<html lang="en" className="light">
			<body className="light min-h-screen bg-background text-foreground antialiased">
				<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
					<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
						liteSubs
					</p>
					<h1 className="text-2xl font-bold tracking-tight">
						Something went wrong
					</h1>
					<p className="text-sm text-muted-foreground">
						The page could not be displayed. Nothing was charged or changed. Try
						again, or head back to the dashboard.
					</p>
					{error.digest && (
						<p className="font-mono text-xs text-muted-foreground">
							Reference: {error.digest}
						</p>
					)}
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button onClick={() => retry()}>Try again</Button>
						<Button variant="outline" asChild>
							<a href="/dashboard">Go to dashboard</a>
						</Button>
					</div>
				</main>
			</body>
		</html>
	);
}
