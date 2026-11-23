export const CREATOR_SCOPES = [
	"plans:read",
	"plans:write",
	"customers:read",
	"customers:write",
	"billing:read",
	/**
	 * Configure outgoing webhooks and read/manage their delivery history.
	 *
	 * Deliberately separate from `plans:write`: registering an endpoint causes
	 * customer ids, plan ids, and balances to be sent to a URL the caller names,
	 * so it is a data-egress permission an OAuth client must be granted
	 * explicitly. Machine API keys can never hold it (`requireScope` only ever
	 * allows them `credits:consume`).
	 */
	"webhooks:manage",
] as const;
export type Scope = (typeof CREATOR_SCOPES)[number] | "credits:consume";
export type Principal = {
	kind: "session" | "oauth" | "apiKey";
	creatorId: string;
	/**
	 * The signed-in user behind this principal, when there is one.
	 *
	 * `creatorId` is who the principal acts *for*; this is who they *are*. They
	 * differ when a customer session acts inside a creator's workspace without
	 * pretending the customer is a creator.
	 */
	userId?: string;
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

/**
 * Authorize one action for one principal.
 *
 * The rule is **the principal's scopes**, whatever transport produced them. A
 * key granted `plans:write` may manage plans; a key granted only
 * `credits:consume` may only spend. There is deliberately no blanket "machine
 * keys can only consume" rule: that forced every non-consumption integration
 * into an OAuth app, which is a whole CIMD client, a consent screen and a public
 * metadata URL — for a job a scoped key does exactly as well.
 *
 * What keeps that safe is that **scopes come from the stored key**, never from
 * the request. `apiKeyPrincipal` reads them off the key; nothing a caller sends
 * can widen them.
 *
 * `credits:consume` stays API-key-*preferred* only in the sense that OAuth is
 * refused it: consumption is the operation that spends money, and it should
 * belong to a credential a teacher can name and revoke in isolation rather than
 * to a broad management grant.
 */
export function requireScope(principal: Principal, scope: Scope) {
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
		userId: creatorId,
		scopes: [...CREATOR_SCOPES, "credits:consume"],
	};
}
