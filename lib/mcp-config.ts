import { appUrl } from "@/lib/app-url";
export const mcpResource =
	process.env.MCP_RESOURCE_URL?.trim() || appUrl("/api/mcp");
