"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { CodeBlock } from "@/components/docs/code-block";
import { type DocSection, DocsNav } from "@/components/docs/docs-nav";
import { Button } from "@/components/ui/button";
import { getAppUrl } from "@/lib/app-url";
import { mcpResource } from "@/lib/mcp-config";

const endpoints = [
	["GET / POST", "/api/v1/plans", "Read or create plans"],
	["GET / PATCH", "/api/v1/plans/:id", "Read or update a plan"],
	["GET", "/api/v1/customers", "Read enrolled customers"],
	["GET", "/api/v1/customers/:id", "Read a customer's per-plan balances"],
	["POST", "/api/v1/enrollments", "Enroll or invite a customer"],
	["POST", "/api/v1/credits/grant", "Grant credits"],
	["POST", "/api/v1/credits/consume", "Consume credits with a machine key"],
	["GET", "/api/v1/transactions", "Read transaction history"],
	["GET / POST", "/api/v1/invites", "Read or create invites"],
];

const sections: DocSection[] = [
	{ id: "quickstart", title: "Quickstart" },
	{ id: "mcp", title: "Connect an AI assistant" },
	{ id: "authentication", title: "Authentication" },
	{ id: "api", title: "REST API" },
	{ id: "credits", title: "Credits and retries" },
	{ id: "enrollment", title: "Enrollment" },
];

function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-24 space-y-4">
			<h2 className="text-xl font-semibold tracking-tight">{title}</h2>
			<div className="space-y-4 text-sm leading-relaxed text-foreground/90">
				{children}
			</div>
		</section>
	);
}

export function IntegrationDocs({ embedded = false }: { embedded?: boolean }) {
	const base = getAppUrl();

	return (
		<div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
			<div className="lg:sticky lg:top-24 lg:self-start">
				<p className="mb-3 hidden text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:block">
					On this page
				</p>
				<DocsNav sections={sections} />
				{!embedded && (
					<div className="mt-6 hidden border-t pt-4 lg:block">
						<Link
							href="/dashboard/developers/api-keys"
							className="group inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
						>
							Manage API tokens
							<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
						</Link>
					</div>
				)}
			</div>

			<div className="min-w-0 space-y-14">
				<Section id="quickstart" title="Quickstart">
					<p className="text-muted-foreground">
						Three steps take you from an empty account to credits being consumed
						by your own app. Each step is useful on its own.
					</p>

					<ol className="grid gap-3">
						{[
							{
								title: "Create a plan",
								body: "A plan is a bundle of credits at a price: “Algebra Tutoring, 10 credits, $100”.",
								href: "/dashboard/packs",
								cta: "Create a plan",
							},
							{
								title: "Enroll a customer",
								body: "Send a checkout link or grant complimentary credits. The balance belongs to that customer and that plan.",
								href: "/dashboard/customers",
								cta: "See customers",
							},
							{
								title: "Consume a credit",
								body: "Call the consume endpoint with a machine key whenever the customer uses the service.",
								href: "/dashboard/developers/api-keys",
								cta: "Generate a key",
							},
						].map((step, index) => (
							<li
								key={step.title}
								className="flex gap-4 rounded-xl border bg-card p-4"
							>
								<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
									{index + 1}
								</span>
								<div className="space-y-1.5">
									<p className="font-medium">{step.title}</p>
									<p className="text-sm text-muted-foreground">{step.body}</p>
									<Link
										href={step.href}
										className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4"
									>
										{step.cta}
										<ArrowRight className="size-3.5" />
									</Link>
								</div>
							</li>
						))}
					</ol>

					<Callout type="tip" title="Want to see it filled in first?">
						The dashboard can load a sample plan and a sample customer with a
						worked ledger. Remove them in one click when you are ready for your
						own data.{" "}
						<Link href="/dashboard" className="underline underline-offset-4">
							Open the dashboard
						</Link>
						.
					</Callout>
				</Section>

				<Section id="mcp" title="Connect an AI assistant">
					<p>
						Litesubs is a remote MCP server. Add this endpoint to a compatible
						client and your assistant can manage plans, enroll customers and
						grant credits for you:
					</p>
					<CodeBlock language="endpoint" code={mcpResource} />

					<CodeBlock
						language="json · mcp client config"
						code={`{
  "mcpServers": {
    "litesubs": {
      "type": "http",
      "url": "${mcpResource}"
    }
  }
}`}
					/>

					<ol className="list-decimal space-y-2 pl-5">
						<li>
							Choose a remote HTTP MCP connection in your client and paste the
							endpoint above.
						</li>
						<li>Sign in to Litesubs and review the requested permissions.</li>
						<li>
							Approve access, then ask your assistant to create a plan, enroll a
							student, or grant credits.
						</li>
					</ol>

					<p>
						Example prompts:{" "}
						<q>Create an Algebra plan with 10 credits for $100.</q>{" "}
						<q>
							Enroll ana@example.com in Algebra and give me the payment link.
						</q>
					</p>

					<p>
						The server implements the stateless MCP 2026-07-28 profile with CIMD
						client identification. Legacy session-based and DCR-only clients are
						not currently supported; if your client cannot connect, check its
						protocol support.
					</p>

					<p>
						Creator tools: list/get/create/update plans, list/get customers,
						enroll customers, grant credits, and list transactions. The
						consumption tool is available to machine keys only. No payout or
						refund tools are exposed. Scope failures return structured tool
						errors.
					</p>
				</Section>

				<Section id="authentication" title="Authentication">
					<p>
						<strong>Creator operations:</strong> use OAuth through your MCP
						client. The scopes are <code>plans:read</code>,{" "}
						<code>plans:write</code>, <code>customers:read</code>,{" "}
						<code>customers:write</code>, and <code>billing:read</code>. An
						OAuth access token can also call REST endpoints with{" "}
						<code>Authorization: Bearer &lt;token&gt;</code>.
					</p>
					<p>
						<strong>Machine consumption:</strong> generate an API token and send
						it in the <code>x-api-key</code> header. Tokens only consume
						credits; they cannot edit plans, grant credits, or read billing
						history. Keep them on your backend, never in public frontend code.
					</p>
					<Button asChild variant="outline" size="sm">
						<Link href="/dashboard/developers/api-keys">
							Generate an API token
						</Link>
					</Button>
					<CodeBlock
						language="http"
						code={`Authorization: Bearer <oauth token>   # creator operations
x-api-key: <machine token>            # consumption only`}
					/>
					<p>
						Tokens are shown once when generated. Save them securely; revoke and
						replace a lost or exposed token. Token expiration and rate limits
						are enforced on verification.
					</p>
				</Section>

				<Section id="api" title="REST API">
					<p>
						Base URL: <code>{base}</code>. Send JSON bodies with{" "}
						<code>Content-Type: application/json</code>. List routes accept{" "}
						<code>limit</code> (1–100, default 50) and <code>offset</code>.
					</p>
					<div className="overflow-x-auto rounded-xl border">
						<table className="w-full text-left text-sm">
							<caption className="sr-only">REST API endpoints</caption>
							<thead className="bg-muted/50">
								<tr>
									<th scope="col" className="px-4 py-2.5 font-medium">
										Method
									</th>
									<th scope="col" className="px-4 py-2.5 font-medium">
										Path
									</th>
									<th scope="col" className="px-4 py-2.5 font-medium">
										Purpose
									</th>
								</tr>
							</thead>
							<tbody>
								{endpoints.map(([method, path, purpose]) => (
									<tr key={path} className="border-t">
										<td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
											{method}
										</td>
										<td className="whitespace-nowrap px-4 py-2.5">
											<code className="text-[12.5px]">{path}</code>
										</td>
										<td className="px-4 py-2.5 text-muted-foreground">
											{purpose}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<p>
						Plan creation takes{" "}
						<code>
							{'{"name":"Algebra","price":100,"credits":10,"currency":"usd"}'}
						</code>
						. Input prices are in major units ($100); returned prices are in
						minor units (10000 cents). Currencies: USD and EUR. Updating a plan
						does not change existing balances.
					</p>
					<CodeBlock
						language="curl · create a plan"
						code={`curl -X POST '${base}/api/v1/plans' \\
  -H 'Authorization: Bearer <oauth token>' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Algebra","price":100,"credits":10,"currency":"usd"}'`}
					/>
					<p>
						Errors return <code>error</code>, <code>code</code>, and optional{" "}
						<code>details</code> or <code>fieldErrors</code>. Expect 400 for
						invalid input, 401 for failed authentication, 403 for missing
						access, 404 for missing resources, and 409 for ambiguous identifiers
						or credit conflicts.
					</p>
				</Section>

				<Section id="credits" title="Credits and retries">
					<p>
						Balances belong to a customer and a specific plan, not a shared
						wallet. Use exact names, emails, or IDs; ambiguous names require an
						explicit ID. Credits cannot go negative.
					</p>
					<CodeBlock
						language="curl · consume one credit"
						code={`curl -X POST '${base}/api/v1/credits/consume' \\
  -H 'x-api-key: <your token>' \\
  -H 'Content-Type: application/json' \\
  -d '{"customer":"ana@example.com","plan":"Algebra","amount":1,"reason":"Lesson completed","idempotency_key":"booking_8812"}'`}
					/>
					<p>
						A stable <code>idempotency_key</code> is required for consumption.
						Reuse it when retrying the same event: the original receipt is
						returned without another debit. A different payload using the same
						key returns a conflict. Grants accept an optional key.
					</p>
					<p>
						<code>reason</code> is required and visible in the customer ledger.
						Set <code>dry_run: true</code> to preview a before/after balance
						without writing or reserving a key. Receipts contain{" "}
						<code>transactionId</code>, <code>before</code>, <code>after</code>,{" "}
						<code>dryRun</code>, and <code>replayed</code>.
					</p>
					<CodeBlock
						language="json · response"
						code={`{
  "transactionId": "f2c1…",
  "before": 10,
  "after": 9,
  "dryRun": false,
  "replayed": false
}`}
					/>
					<Callout type="warning" title="Retry safety">
						Generate the key from the event that caused the debit (a booking ID,
						a message ID), not from a timestamp. A new key for the same event
						charges the customer twice.
					</Callout>
				</Section>

				<Section id="enrollment" title="Enrollment">
					<p>
						Send{" "}
						<code>
							{
								'{"customer":"ana@example.com","plan":"Algebra","mode":"invoice"}'
							}
						</code>{" "}
						to <code>/api/v1/enrollments</code>, or use{" "}
						<code>enroll_customer</code> in MCP. Invoice mode is the default; it
						returns a checkout link and grants credits only after payment.
					</p>
					<CodeBlock
						language="curl · enroll a customer"
						code={`curl -X POST '${base}/api/v1/enrollments' \\
  -H 'Authorization: Bearer <oauth token>' \\
  -H 'Content-Type: application/json' \\
  -d '{"customer":"ana@example.com","plan":"Algebra","mode":"invoice"}'`}
					/>
					<p>
						For complimentary access, set <code>mode: "comp"</code> and provide
						a reason. An existing enrollment cannot be comped again; use a
						separate credit grant.
					</p>
					<p>
						If the student has no account, the result is <code>invited</code>{" "}
						with an expiring claim link. Complimentary credits are granted once
						on claim. <strong>No email is sent.</strong> Forward the returned
						invitation or payment link yourself.
					</p>
				</Section>
			</div>
		</div>
	);
}
