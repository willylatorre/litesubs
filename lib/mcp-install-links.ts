/**
 * Install affordances for the remote MCP server.
 *
 * Every builder here is pure and takes the resource URL, so the docs page,
 * the dashboard and tests all agree on the same endpoint. Client formats move
 * fast; the comments name the source for each one so the next edit knows what
 * to re-check.
 */

export const MCP_SERVER_NAME = "litesubs";

/**
 * Cursor resolves `${env:NAME}` in config values locally, so an install link can
 * carry a credential reference instead of a secret. Built by concatenation to
 * keep the literal visible without tripping template-string lint.
 */
const CURSOR_API_KEY_REF = ["$", "{env:LITESUBS_API_KEY}"].join("");

/** base64url with no padding. `btoa` exists in browsers, Node 16+ and workerd. */
function base64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Claude Code: add the remote server, then complete the browser sign-in. */
export function claudeCodeCommand(resource: string): string {
	return [
		`claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${resource}`,
		`claude mcp login ${MCP_SERVER_NAME}`,
	].join("\n");
}

/** OpenAI Codex CLI. `codex mcp login` runs the OAuth flow. */
export function codexCommand(resource: string): string {
	return [
		`codex mcp add ${MCP_SERVER_NAME} --url ${resource}`,
		`codex mcp login ${MCP_SERVER_NAME}`,
	].join("\n");
}

/**
 * claude.ai / Claude Desktop: pre-fills the "Add custom connector" dialog.
 * Source: claude.ai connector dialog parameters.
 */
export function claudeConnectorLink(resource: string): string {
	const params = new URLSearchParams({
		modal: "add-custom-connector",
		connectorName: "Litesubs",
		connectorUrl: resource,
	});
	return `https://claude.ai/customize/connectors?${params.toString()}`;
}

/**
 * Cursor: config is the server object without a name, base64url encoded.
 * Source: cursor.com/docs/context/mcp/install-links
 */
export function cursorInstallLink(resource: string): string {
	// Consumption-only connection: Cursor cannot use CIMD, and this app
	// deliberately leaves open dynamic client registration off.
	const config = {
		url: resource,
		headers: { "x-api-key": CURSOR_API_KEY_REF },
	};
	return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${base64Url(
		JSON.stringify(config),
	)}`;
}

/** Cursor's web-hosted equivalent, safe to use in a page or README. */
export function cursorInstallPageLink(resource: string): string {
	const config = {
		url: resource,
		headers: { "x-api-key": CURSOR_API_KEY_REF },
	};
	return `https://cursor.com/en/install-mcp?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(
		base64Url(JSON.stringify(config)),
	)}`;
}

/**
 * VS Code (and Copilot Chat): the name lives inside the config.
 * Source: code.visualstudio.com/api/extension-guides/ai/mcp
 */
export function vscodeInstallLink(resource: string): string {
	const config = { name: MCP_SERVER_NAME, type: "http", url: resource };
	return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(config))}`;
}

/** VS Code's https hand-off, for places that will not run a vscode: link. */
export function vscodeInstallPageLink(resource: string): string {
	const config = { name: MCP_SERVER_NAME, type: "http", url: resource };
	return `https://vscode.dev/redirect/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(
		JSON.stringify(config),
	)}`;
}

/** Generic `mcpServers` block for any other remote-HTTP client. */
export function clientConfig(resource: string): string {
	return JSON.stringify(
		{ mcpServers: { [MCP_SERVER_NAME]: { type: "http", url: resource } } },
		null,
		2,
	);
}
