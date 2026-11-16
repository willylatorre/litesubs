import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Not-found page.
 *
 * Price and invite links are the ones most likely to 404 (expired token, plan
 * unlisted), so the copy names those cases instead of a generic "not found".
 */
export default function NotFound() {
	return (
		<main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
			<p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
				404
			</p>
			<h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
			<p className="text-sm text-muted-foreground">
				This link may have expired, or the plan may no longer be available.
			</p>
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Button asChild>
					<Link href="/dashboard">Go to dashboard</Link>
				</Button>
				<Button variant="outline" asChild>
					<Link href="/">Back home</Link>
				</Button>
			</div>
		</main>
	);
}
