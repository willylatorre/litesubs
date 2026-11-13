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
