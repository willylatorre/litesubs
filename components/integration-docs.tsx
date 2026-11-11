import Link from "next/link";
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

export function IntegrationDocs() {
	const base = getAppUrl();
	return (
		<div className="grid gap-10 md:grid-cols-[12rem_minmax(0,1fr)]">
			<nav
				aria-label="Documentation sections"
				className="flex flex-wrap gap-4 text-sm md:flex-col md:items-start"
			>
				{[
					["mcp", "Connect an AI assistant"],
					["authentication", "Authentication"],
					["api", "REST API"],
					["credits", "Credits and retries"],
					["enrollment", "Enrollment"],
				].map(([id, title]) => (
					<a key={id} href={`#${id}`} className="underline underline-offset-4">
						{title}
					</a>
				))}
				<Link
					href="/dashboard/developers/api-keys"
					className="font-semibold underline underline-offset-4"
				>
					Manage API tokens
				</Link>
			</nav>
			<div className="min-w-0 space-y-12 text-sm leading-relaxed">
				<section id="mcp" className="scroll-mt-8 space-y-4">
					<h2 className="text-xl font-semibold">Connect an AI assistant</h2>
					<p>
						Add Litesubs as a remote MCP server in a compatible client. Use this
						URL:
					</p>
					<pre className="overflow-x-auto rounded-lg bg-muted p-4">
						<code>{mcpResource}</code>
					</pre>
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
						Example: <q>Create an Algebra plan with 10 credits for $100.</q> Or:{" "}
						<q>
							Enroll ana@example.com in Algebra and give me the payment link.
						</q>
					</p>
					<p>
						Supports the stateless MCP 2026-07-28 profile and CIMD client
						identification. Legacy session-based and DCR-only clients are not
						currently supported. If your client cannot connect, check its
						protocol support.
					</p>
					<p>
						Creator tools: list/get/create/update plans, list/get customers,
						enroll customers, grant credits, and list transactions. The
						consumption tool is available to machine keys only. No payout or
						refund tools are exposed.
					</p>
				</section>
				<section id="authentication" className="scroll-mt-8 space-y-4">
					<h2 className="text-xl font-semibold">Authentication</h2>
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
					<Button asChild variant="outline">
						<Link href="/dashboard/developers/api-keys">
							Generate an API token
						</Link>
					</Button>
					<p>
						Tokens are shown once when generated. Save them securely; revoke and
						replace a lost or exposed token. Token expiration and rate limits
						are enforced on verification.
					</p>
				</section>
				<section id="api" className="scroll-mt-8 space-y-4">
					<h2 className="text-xl font-semibold">REST API</h2>
					<p>
						Base URL: <code>{base}</code>. Send JSON bodies with{" "}
						<code>Content-Type: application/json</code>. List routes accept{" "}
						<code>limit</code> (1–100, default 50) and <code>offset</code>.
					</p>
					<div className="overflow-x-auto">
						<table className="w-full text-left">
							<caption className="sr-only">REST API endpoints</caption>
							<thead>
								<tr className="border-b">
									<th scope="col" className="py-3 pr-4">
										Method
									</th>
									<th scope="col" className="py-3 pr-4">
										Path
									</th>
									<th scope="col" className="py-3">
										Purpose
									</th>
								</tr>
							</thead>
							<tbody>
								{endpoints.map(([method, path, purpose]) => (
									<tr key={path} className="border-b">
										<td className="whitespace-nowrap py-3 pr-4">{method}</td>
										<td className="whitespace-nowrap py-3 pr-4">
											<code>{path}</code>
										</td>
										<td className="py-3">{purpose}</td>
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
					<p>
						Errors return <code>error</code>, <code>code</code>, and optional{" "}
						<code>details</code> or <code>fieldErrors</code>. Expect 400 for
						invalid input, 401 for failed authentication, 403 for missing
						access, 404 for missing resources, and 409 for ambiguous identifiers
						or credit conflicts.
					</p>
				</section>
				<section id="credits" className="scroll-mt-8 space-y-4">
					<h2 className="text-xl font-semibold">Credits and retries</h2>
					<p>
						Balances belong to a customer and a specific plan, not a shared
						wallet. Use exact names, emails, or IDs; ambiguous names require an
						explicit ID. Credits cannot go negative.
					</p>
					<pre className="overflow-x-auto rounded-lg bg-muted p-4">
						<code>{`curl '${base}/api/v1/credits/consume' \\\n+  -H 'x-api-key: <your token>' \\\n+  -H 'Content-Type: application/json' \\\n+  -d '{"customer":"ana@example.com","plan":"Algebra","amount":1,"reason":"Lesson completed","idempotency_key":"booking_8812"}'`}</code>
					</pre>
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
				</section>
				<section id="enrollment" className="scroll-mt-8 space-y-4">
					<h2 className="text-xl font-semibold">Enrollment</h2>
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
				</section>
			</div>
		</div>
	);
}
