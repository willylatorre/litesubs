import assert from "node:assert/strict";
import { test } from "node:test";
import {
	claudeCodeCommand,
	claudeConnectorLink,
	clientConfig,
	codexCommand,
	cursorInstallLink,
	vscodeInstallLink,
} from "@/lib/mcp-install-links";

const resource = "https://litesubs.com/api/mcp";

function decodeBase64Url(value: string): string {
	assert.doesNotMatch(
		value,
		/[+/=]/,
		"base64url must not carry + / or padding",
	);
	const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
	return new TextDecoder().decode(
		Uint8Array.from(binary, (char) => char.charCodeAt(0)),
	);
}

test("install commands target the configured resource", () => {
	const claude = claudeCodeCommand(resource);
	assert.match(claude, /claude mcp add --transport http --scope user litesubs/);
	assert.match(
		claude,
		new RegExp(resource.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);
	assert.match(claude, /claude mcp login litesubs/);

	const codex = codexCommand(resource);
	assert.match(codex, /codex mcp add litesubs --url/);
	assert.match(codex, /codex mcp login litesubs/);
});

test("deeplinks decode back to the server config each client expects", () => {
	const cursor = new URL(
		cursorInstallLink(resource).replace("cursor://", "https://"),
	);
	assert.equal(cursor.host, "anysphere.cursor-deeplink");
	assert.equal(cursor.pathname, "/mcp/install");
	assert.equal(cursor.searchParams.get("name"), "litesubs");
	const cursorConfig = JSON.parse(
		decodeBase64Url(cursor.searchParams.get("config") ?? ""),
	);
	assert.equal(cursorConfig.url, resource);
	// Never bake a key into a public link; an env reference is resolved locally.
	assert.ok(
		/^\$\{env:LITESUBS_API_KEY\}$/.test(cursorConfig.headers["x-api-key"]),
	);
	assert.doesNotMatch(cursorInstallLink(resource), /sk_|Bearer/);

	const vscode = vscodeInstallLink(resource);
	assert.ok(vscode.startsWith("vscode:mcp/install?"));
	const vscodeConfig = JSON.parse(
		decodeURIComponent(vscode.slice("vscode:mcp/install?".length)),
	);
	assert.deepEqual(vscodeConfig, {
		name: "litesubs",
		type: "http",
		url: resource,
	});
});

test("claude.ai connector link pre-fills both fields, and the generic block is valid JSON", () => {
	const link = new URL(claudeConnectorLink(resource));
	assert.equal(link.searchParams.get("connectorName"), "Litesubs");
	assert.equal(link.searchParams.get("connectorUrl"), resource);

	const config = JSON.parse(clientConfig(resource));
	assert.deepEqual(config.mcpServers.litesubs, {
		type: "http",
		url: resource,
	});
});
