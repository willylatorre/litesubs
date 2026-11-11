"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Callout } from "@/components/docs/callout";
import { CodeBlock } from "@/components/docs/code-block";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAppUrl } from "@/lib/app-url";
import { mcpResource } from "@/lib/mcp-config";
import {
	claudeCodeCommand,
	claudeConnectorLink,
	clientConfig,
	codexCommand,
	cursorInstallPageLink,
	vscodeInstallPageLink,
} from "@/lib/mcp-install-links";

function Steps({ children }: { children: React.ReactNode }) {
	return (
		<ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
			{children}
		</ol>
	);
}

/**
 * Client-by-client install instructions.
 *
 * Two different credentials are in play, and the distinction is the whole
 * point of this section:
 *   - OAuth (creator tools) needs a client that supports CIMD, because this
 *     server does not run open dynamic client registration.
 *   - An API key (consumption only) works everywhere, including clients with
 *     no OAuth support at all.
 */
export function McpInstall() {
	const base = getAppUrl();
	const resource = mcpResource;

	return (
		<div className="space-y-4">
			<Tabs defaultValue="claude-code">
				<TabsList className="flex h-auto w-full flex-wrap justify-start">
					<TabsTrigger value="claude-code">Claude Code</TabsTrigger>
					<TabsTrigger value="claude">Claude</TabsTrigger>
					<TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
					<TabsTrigger value="cursor">Cursor</TabsTrigger>
					<TabsTrigger value="vscode">VS Code</TabsTrigger>
					<TabsTrigger value="codex">Codex</TabsTrigger>
					<TabsTrigger value="other">Other clients</TabsTrigger>
				</TabsList>

				<TabsContent value="claude-code" className="space-y-4 pt-4">
					<p className="text-sm text-muted-foreground">
						Two commands: add the server, then sign in. The sign-in opens your
						browser and stores a refreshable token.
					</p>
					<CodeBlock
						language="shell · Claude Code"
						code={claudeCodeCommand(resource)}
					/>
					<p className="text-sm text-muted-foreground">
						Run <code>claude mcp list</code> to check the status. It reads{" "}
						<code>! Needs authentication</code> until you finish the browser
						step, then <code>✔ Connected</code>. Inside a session,{" "}
						<code>/mcp</code> does the same sign-in and shows the tool count.
					</p>
					<p className="text-sm text-muted-foreground">
						Already signed in and want to switch accounts?{" "}
						<code>claude mcp logout litesubs</code> clears the stored token.
					</p>
				</TabsContent>

				<TabsContent value="claude" className="space-y-4 pt-4">
					<p className="text-sm text-muted-foreground">
						Applies to claude.ai, Claude Desktop and the mobile apps. These
						connectors talk to the server from Anthropic&apos;s infrastructure,
						so the URL must be the public HTTPS endpoint (it is).
					</p>
					<Steps>
						<li>
							Open{" "}
							<Button asChild size="sm" variant="outline">
								<a
									href={claudeConnectorLink(resource)}
									target="_blank"
									rel="noreferrer"
								>
									Add custom connector
									<ArrowUpRight className="size-3.5" />
								</a>
							</Button>{" "}
							(or go to{" "}
							<strong>Customize → Connectors → Add custom connector</strong>).
						</li>
						<li>
							Keep the prefilled name and URL. Under OAuth client, leave{" "}
							<strong>Use Claude&apos;s published identity</strong> selected —
							this server identifies clients from a metadata document rather
							than registering them.
						</li>
						<li>Add the connector, then press Connect and approve access.</li>
						<li>
							In a chat, open the connectors menu and pick Litesubs before
							asking for something like{" "}
							<q>Create an Algebra plan with 10 credits for $100.</q>
						</li>
					</Steps>
					<Callout type="note" title="Free plans">
						Claude&apos;s free tier allows a single custom connector. Team and
						Enterprise accounts need an Owner to add it under organization
						settings before members can connect.
					</Callout>
				</TabsContent>

				<TabsContent value="chatgpt" className="space-y-4 pt-4">
					<p className="text-sm text-muted-foreground">
						ChatGPT adds MCP servers through the web app, not a link. Sign-in
						uses the same OAuth flow as Claude and needs no client ID from you.
					</p>
					<Steps>
						<li>
							In ChatGPT on the web, open <strong>Plugins</strong> and select
							the plus button, then <strong>Add custom MCP server</strong>.
						</li>
						<li>
							Name it <code>Litesubs</code> and paste the server URL:
							<CodeBlock language="endpoint" code={resource} className="mt-2" />
						</li>
						<li>
							Set authentication to <strong>OAuth</strong>, acknowledge the risk
							warning, and create the plugin.
						</li>
						<li>
							Install it from your personal plugins, then approve the Litesubs
							sign-in when you first use a tool.
						</li>
						<li>
							In a conversation, type <code>@</code> and choose Litesubs. Be
							specific:{" "}
							<q>Use Litesubs to enroll ana@example.com in Algebra.</q>
						</li>
					</Steps>
					<Callout type="warning" title="Check plan eligibility">
						Custom MCP servers are gated by ChatGPT plan and workspace policy.
						If the option is missing, your workspace has it disabled and no
						server-side change will fix that.
					</Callout>
				</TabsContent>

				<TabsContent value="cursor" className="space-y-4 pt-4">
					<p className="text-sm text-muted-foreground">
						Cursor cannot complete the OAuth flow with this server yet, so a
						Cursor connection authenticates with an API token and can only
						consume credits — it cannot manage plans or enroll customers.
					</p>
					<Steps>
						<li>
							Generate a token at{" "}
							<Link
								href="/dashboard/developers/api-keys"
								className="underline underline-offset-4"
							>
								API tokens
							</Link>
							. Copy it once; it is not shown again.
						</li>
						<li>
							Add it to your shell profile so the editor can read it:
							<CodeBlock
								language="shell"
								code={`export LITESUBS_API_KEY="<your token>"`}
								className="mt-2"
							/>
						</li>
						<li>
							Install the server, then restart Cursor.
							<Button asChild size="sm" variant="outline" className="mt-2 ml-1">
								<a
									href={cursorInstallPageLink(resource)}
									target="_blank"
									rel="noreferrer"
								>
									Add to Cursor
									<ArrowUpRight className="size-3.5" />
								</a>
							</Button>
						</li>
					</Steps>
					<CodeBlock
						language="json · cursor mcp.json"
						code={`{
  "mcpServers": {
    "litesubs": {
      "url": "${resource}",
      "headers": { "x-api-key": "\${env:LITESUBS_API_KEY}" }
    }
  }
}`}
					/>
					<Callout type="note" title="Why the token, not sign-in">
						Cursor registers OAuth clients dynamically. Litesubs deliberately
						declines open dynamic registration because it lets any caller mint a
						creator-level client. Supporting Cursor with full OAuth needs a
						pre-registered client ID — see the note at the end of this section.
					</Callout>
				</TabsContent>

				<TabsContent value="vscode" className="space-y-4 pt-4">
					<p className="text-sm text-muted-foreground">
						VS Code 1.106 and later can identify itself with a metadata
						document, so Copilot Chat can sign in and use every creator tool.
					</p>
					<Steps>
						<li>
							Install the server:
							<Button asChild size="sm" variant="outline" className="mt-2 ml-1">
								<a
									href={vscodeInstallPageLink(resource)}
									target="_blank"
									rel="noreferrer"
								>
									Add to VS Code
									<ArrowUpRight className="size-3.5" />
								</a>
							</Button>
						</li>
						<li>
							Approve the server in the prompt, then run{" "}
							<strong>MCP: List Servers</strong> and start Litesubs.
						</li>
						<li>
							Choose the server when prompted to sign in, and approve access in
							the browser.
						</li>
					</Steps>
					<p className="text-sm text-muted-foreground">
						Prefer a config file? Add this to <code>.vscode/mcp.json</code>:
					</p>
					<CodeBlock
						language="json · vscode mcp.json"
						code={`{
  "servers": {
    "litesubs": { "type": "http", "url": "${resource}" }
  }
}`}
					/>
				</TabsContent>

				<TabsContent value="codex" className="space-y-4 pt-4">
					<p className="text-sm text-muted-foreground">
						Codex authenticates the same way Claude Code does: add the server,
						then log in.
					</p>
					<CodeBlock
						language="shell · Codex CLI"
						code={codexCommand(resource)}
					/>
					<p className="text-sm text-muted-foreground">
						Or add it by hand in <code>~/.codex/config.toml</code>:
					</p>
					<CodeBlock
						language="toml · config.toml"
						code={`[mcp_servers.litesubs]
url = "${resource}"`}
					/>
				</TabsContent>

				<TabsContent value="other" className="space-y-4 pt-4">
					<p className="text-sm text-muted-foreground">
						Any client that speaks remote HTTP MCP can use the same endpoint.
						Clients that support metadata-document identification get the whole
						creator toolset; the rest can use an API token to consume credits.
					</p>
					<CodeBlock
						language="json · mcpServers"
						code={clientConfig(resource)}
					/>
					<p className="text-sm text-muted-foreground">
						Two rules that decide whether a client will work:
					</p>
					<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
						<li>
							Transport must be remote streamable HTTP over HTTPS. Local stdio
							servers, SSE-only clients and <code>localhost</code> URLs cannot
							reach this endpoint.
						</li>
						<li>
							OAuth clients must support client metadata documents (CIMD). Open
							dynamic registration is disabled, so a DCR-only client gets no
							creator access.
						</li>
					</ul>
					<p className="text-sm text-muted-foreground">
						Not implemented: a pre-registered OAuth client, which is what
						DCR-only clients would need. Payout, refund and billing-charge tools
						are deliberately absent.
					</p>
				</TabsContent>
			</Tabs>

			<Callout type="tip" title="Which credential do I need?">
				<strong>OAuth, through the client</strong> — manage plans, enroll
				customers, grant credits, read transactions.{" "}
				<strong>An API token</strong> — only <code>consume_credits</code>, for
				code running on your own backend. Tokens never grant credits or read
				billing, by design. Base URL for REST: <code>{base}/api/v1</code>.
			</Callout>
		</div>
	);
}
