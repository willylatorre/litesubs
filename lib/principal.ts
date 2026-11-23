import { requireMcpAuth } from "@better-auth/mcp";
import { auth } from "@/lib/auth";
import { mcpResource } from "@/lib/mcp-config";
import {
	CREATOR_SCOPES,
	type Principal,
	ServiceError,
	sessionPrincipal,
} from "@/lib/services/principal";

/**
 * Verify an `x-api-key` and build its principal.
 *
 * A key carries the scopes it was **granted**, as a `permission:action` map
 * stored on the key itself — not a fixed set. Two reasons:
 *
 * - An integration key needs to do what a connection does (manage plans and
 *   customers); a booking key needs `credits:consume`. Forcing one shape would
 *   mean one of them is written as an OAuth app for no reason.
 * - The scope model already exists in `requireScope`; the key's permissions are
 *   just another source of them, so no new authorization concept is invented.
 *
 * The request asks for no particular permission, because this only establishes
 * *who is calling*. Each service's `requireScope` still decides what they may
 * do, which is why a leaked consumption key cannot rewrite prices.
 */
export async function apiKeyPrincipal(key: string): Promise<Principal> {
	const result = await auth.api.verifyApiKey({ body: { key } });
	if (!result.valid || !result.key || result.key.configId !== "default")
		throw new ServiceError("UNAUTHORIZED", "Invalid or expired API key", 401);

	const permissions =
		(result.key.permissions as Record<string, string[]> | null) ?? {};
	const scopes = scopesFromPermissions(permissions);
	if (scopes.length === 0)
		throw new ServiceError(
			"INSUFFICIENT_SCOPE",
			"This key has no scopes",
			403,
		);
	return {
		kind: "apiKey",
		creatorId: result.key.referenceId,
		scopes,
	};
}

/**
 * Turn the stored `{ resource: [action] }` map into `resource:action` scopes.
 *
 * This is the same string shape the OAuth path derives from a token, so both
 * transports feed one `requireScope` and neither gets a private rule.
 */
export function scopesFromPermissions(
	permissions: Record<string, string[]>,
): string[] {
	const scopes: string[] = [];
	for (const [resource, actions] of Object.entries(permissions)) {
		if (resource === "credits" && Array.isArray(actions)) {
			// `credits:consume` is the only credit action; keep the name stable.
			if (actions.includes("consume")) scopes.push("credits:consume");
			continue;
		}
		if (!Array.isArray(actions)) continue;
		for (const action of actions) scopes.push(`${resource}:${action}`);
	}
	return scopes;
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
