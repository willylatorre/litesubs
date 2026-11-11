import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
	createMcpHandler,
} from "@modelcontextprotocol/server";
import { createServer } from "@/lib/mcp-tools";

const principal = {
	kind: "oauth" as const,
	creatorId: "c1",
	scopes: ["plans:read"],
};

const handler = createMcpHandler(() => createServer(principal), {
	legacy: "reject",
});

const response = await handler.fetch(
	new Request("http://localhost/api/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": "2026-07-28",
			"Mcp-Method": "tools/call",
			"Mcp-Name": "create_plan",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: {
				name: "create_plan",
				arguments: {
					name: "Not allowed",
					terms: { billingMode: "one_time", price: 10, credits: 1 },
				},
				_meta: {
					[PROTOCOL_VERSION_META_KEY]: "2026-07-28",
					[CLIENT_CAPABILITIES_META_KEY]: {},
					[CLIENT_INFO_META_KEY]: { name: "probe", version: "1" },
				},
			},
		}),
	}),
);

const body = await response.json();
console.log(JSON.stringify(body, null, 2).slice(0, 1500));
