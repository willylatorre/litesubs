export const CREATOR_SCOPES = [
	"plans:read",
	"plans:write",
	"customers:read",
	"customers:write",
	"billing:read",
] as const;
export type Scope = (typeof CREATOR_SCOPES)[number] | "credits:consume";
export type Principal = {
	kind: "session" | "oauth" | "apiKey";
	creatorId: string;
	scopes: readonly string[];
};

export class ServiceError extends Error {
	constructor(
		public code: string,
		message: string,
		public status = 400,
		public details?: unknown,
	) {
		super(message);
	}
}

export function requireScope(principal: Principal, scope: Scope) {
	if (principal.kind === "apiKey" && scope !== "credits:consume") {
		throw new ServiceError(
			"FORBIDDEN",
			"Machine keys can only consume credits",
			403,
		);
	}
	if (scope === "credits:consume" && principal.kind === "oauth") {
		throw new ServiceError("FORBIDDEN", "Consumption requires an API key", 403);
	}
	if (!principal.scopes.includes(scope)) {
		throw new ServiceError(
			"INSUFFICIENT_SCOPE",
			`Missing scope: ${scope}`,
			403,
			{ scopes: [scope] },
		);
	}
}

export function sessionPrincipal(creatorId: string): Principal {
	return {
		kind: "session",
		creatorId,
		scopes: [...CREATOR_SCOPES, "credits:consume"],
	};
}
