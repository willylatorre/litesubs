import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { IntegrationDocs } from "@/components/integration-docs";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
	title: "API & MCP documentation | Litesubs",
	description:
		"Connect an AI assistant to Litesubs or integrate credit consumption through the REST API.",
};

export default function DocsPage() {
	return (
		<PublicShell>
			<main className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
				<header className="max-w-2xl space-y-3">
					<p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
						Developers
					</p>
					<h1 className="text-3xl font-bold tracking-tight md:text-4xl">
						API &amp; MCP documentation
					</h1>
					<p className="text-muted-foreground md:text-lg">
						Manage plans with your AI assistant. Consume credits from your own
						app. Both use the same permission-checked services.
					</p>
					<div className="flex flex-wrap gap-3 pt-1">
						<Button asChild size="lg">
							<Link href="/dashboard/developers/api-keys">
								Get an API token
								<ArrowRight className="size-4" />
							</Link>
						</Button>
						<Button asChild size="lg" variant="outline">
							<Link href="/dashboard">Open the dashboard</Link>
						</Button>
					</div>
				</header>

				<hr className="my-10 border-border/70" />

				<IntegrationDocs />
			</main>
		</PublicShell>
	);
}
