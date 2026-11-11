import { requireMcpAuth } from "@better-auth/mcp";
import { auth } from "@/lib/auth";
import { mcpResource } from "@/lib/mcp-config";
import {
	CREATOR_SCOPES,
	type Principal,
	ServiceError,
	sessionPrincipal,
} from "@/lib/services/principal";

export async function apiKeyPrincipal(key: string): Promise<Principal> {
	const result = await auth.api.verifyApiKey({
		body: { key, permissions: { credits: ["consume"] } },
	});
	if (!result.valid || !result.key || result.key.configId !== "default")
		throw new ServiceError("UNAUTHORIZED", "Invalid or expired API key", 401);
	return {
		kind: "apiKey",
		creatorId: result.key.referenceId,
		scopes: ["credits:consume"],
	};
}

export type AuthenticatedHandler = (
	request: Request,
	principal: Principal,
) => Promise<Response>;

// Explicit credentials win over cookies. A restricted key must never inherit
// permissions from a browser session that happens to accompany the request.
export async function withPrincipal(
	request: Request,
	handler: AuthenticatedHandler,
	allowSession = true,
): Promise<Response> {
	const key = request.headers.get("x-api-key");
	if (key !== null) return handler(request, await apiKeyPrincipal(key));
	if (request.headers.has("authorization")) return withOAuth(request, handler);
	if (allowSession) {
		const session = await auth.api.getSession({ headers: request.headers });
		if (session?.user) {
			if (request.method !== "GET" && request.method !== "HEAD") {
				const origin = request.headers.get("origin");
				if (!origin || !auth.options.trustedOrigins?.includes(origin))
					throw new ServiceError("FORBIDDEN", "Untrusted request origin", 403);
			}
			return handler(request, sessionPrincipal(session.user.id));
		}
	}
	return withOAuth(request, handler);
}

function withOAuth(request: Request, handler: AuthenticatedHandler) {
	return requireMcpAuth(
		auth,
		async (req, claims) => {
			if (typeof claims.sub !== "string" || !claims.sub)
				throw new ServiceError(
					"UNAUTHORIZED",
					"Token has no user subject",
					401,
				);
			const scopes =
				typeof claims.scope === "string" ? claims.scope.split(" ") : [];
			return handler(req, {
				kind: "oauth",
				creatorId: claims.sub,
				scopes: scopes.filter((scope) =>
					(CREATOR_SCOPES as readonly string[]).includes(scope),
				),
			});
		},
		{ resource: mcpResource, challengeScopes: [...CREATOR_SCOPES] },
	)(request);
}
