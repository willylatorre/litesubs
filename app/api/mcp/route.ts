import { createMcpHandler } from "@modelcontextprotocol/server";
import { errorResponse } from "@/lib/api-response";
import { createServer } from "@/lib/mcp-tools";
import { withPrincipal } from "@/lib/principal";

export const runtime = "nodejs";
export async function POST(request: Request) {
	try {
		// A fresh server closes over this request's verified principal; never
		// share mutable auth context across concurrent callers.
		return await withPrincipal(
			request,
			async (req, principal) =>
				createMcpHandler(() => createServer(principal), {
					legacy: "reject",
				}).fetch(req),
			false,
		);
	} catch (error) {
		return errorResponse(error);
	}
}
