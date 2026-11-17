/**
 * MCP tool input schemas are published to clients as JSON Schema, so every
 * registered tool must be expressible that way. A `z.coerce.date()` field compiles
 * in TypeScript but makes `tools/list` fail for every client with
 * "Date cannot be represented in JSON Schema".
 *
 * This guard needs no database: it exercises the real tool registry, not a copy.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { createServer } from "@/lib/mcp-tools";
import { sessionPrincipal } from "@/lib/services/principal";

test("every MCP tool input schema converts to JSON Schema", () => {
	const server = createServer(sessionPrincipal("schema-probe")) as unknown as {
		_registeredTools: Record<string, { inputSchema?: unknown }>;
	};
	const tools = Object.entries(server._registeredTools);
	assert.ok(tools.length > 0, "expected registered tools");

	for (const [name, tool] of tools) {
		assert.doesNotThrow(
			() => z.toJSONSchema(tool.inputSchema as z.ZodType),
			`MCP tool ${name} has an input schema that cannot be published`,
		);
	}
});

/**
 * Invites and outgoing webhooks were REST-only, so an assistant could not build
 * anything that reacts to credit changes or onboard someone without an account.
 * They are tools now, and this pins the set so a capability cannot silently
 * disappear from the assistant surface again.
 */
test("creator tools cover invites and webhooks", () => {
	const server = createServer(sessionPrincipal("schema-probe")) as unknown as {
		_registeredTools: Record<string, unknown>;
	};
	const names = Object.keys(server._registeredTools);

	for (const expected of [
		"list_invites",
		"create_invite",
		"list_webhooks",
		"create_webhook",
		"update_webhook",
		"delete_webhook",
		"list_webhook_deliveries",
		"retry_webhook_delivery",
		"send_test_webhook",
	])
		assert.ok(names.includes(expected), `missing MCP tool: ${expected}`);
});

test("a machine key sees only consume_credits", () => {
	// Webhooks and invites are creator authority; a consumption key must never
	// reach them, here or at the service layer.
	const server = createServer({
		kind: "apiKey",
		creatorId: "schema-probe",
		scopes: ["credits:consume"],
	}) as unknown as { _registeredTools: Record<string, unknown> };

	assert.deepEqual(Object.keys(server._registeredTools), ["consume_credits"]);
});
