import type { Metadata } from "next";
import Link from "next/link";
import { IntegrationDocs } from "@/components/integration-docs";

export const metadata: Metadata = {
	title: "API & MCP documentation | Litesubs",
	description:
		"Connect an AI assistant to Litesubs or integrate credit consumption through the REST API.",
};
export default function DocsPage() {
	return (
		<main className="mx-auto max-w-5xl space-y-10 px-4 py-10 md:px-6">
			<nav
				aria-label="Page navigation"
				className="flex flex-wrap gap-6 text-sm"
			>
				<Link href="/" className="underline underline-offset-4">
					Litesubs
				</Link>
				<Link href="/dashboard" className="underline underline-offset-4">
					Dashboard
				</Link>
			</nav>
			<header className="space-y-3">
				<h1 className="text-3xl font-bold tracking-tight">
					API & MCP documentation
				</h1>
				<p className="max-w-2xl text-muted-foreground">
					Manage plans with your AI assistant. Consume credits from your own
					app. Both use the same permission-checked services.
				</p>
			</header>
			<IntegrationDocs />
		</main>
	);
}
