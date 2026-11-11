import { IntegrationDocs } from "@/components/integration-docs";
export default function DevelopersPage() {
	return (
		<div className="space-y-8 px-4 py-6 lg:px-6">
			<h1 className="text-2xl font-bold tracking-tight">API & MCP</h1>
			<IntegrationDocs />
		</div>
	);
}
