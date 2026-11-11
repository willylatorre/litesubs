import { IntegrationDocs } from "@/components/integration-docs";

export const metadata = {
	title: "API & MCP | Litesubs",
	description:
		"Connect an AI assistant or consume credits from your own backend.",
};

export default function DevelopersPage() {
	return (
		<div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 lg:px-6">
			<header className="space-y-2">
				<h1 className="text-2xl font-bold tracking-tight">API &amp; MCP</h1>
				<p className="text-sm text-muted-foreground">
					Manage plans with an AI assistant, or consume credits from your own
					app. Same services, same permission checks.
				</p>
			</header>
			<IntegrationDocs embedded />
		</div>
	);
}
