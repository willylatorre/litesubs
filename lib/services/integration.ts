import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/app/db";
import { apikey } from "@/app/db/mcp-auth-schema";
import { type Principal, ServiceError } from "./principal";

/**
 * Mint the consume-scoped key a platform needs to spend credits on a creator's
 * behalf, without asking the creator to copy a secret.
 *
 * ## Why this exists
 *
 * A single credential cannot both manage and consume: `requireScope` refuses
 * every creator scope to a machine key, and refuses `credits:consume` to an
 * OAuth token. That split is correct — a stolen OAuth token can rewrite prices,
 * a stolen machine key can only drain a balance — but it means a platform needs
 * two credentials per creator. Making the creator paste one would turn a
 * one-click enable into a support burden, so the platform mints it during the
 * same consent it already received.
 *
 * ## The boundary
 *
 * - **OAuth callers only.** A machine key must never mint another key; that
 *   would let one leaked key escalate to a fresh long-lived credential, and it
 *   would make the scope split meaningless.
 * - The key is always bound to the caller's own `creatorId`. There is no
 *   parameter for whose key to create, so one tenant cannot mint for another.
 * - Permissions are fixed at `credits:consume`. Nothing here can grant
 *   `plans:write`.
 * - The raw key is returned **once**, at creation. Later reads return metadata.
 */

export type MintedIntegrationKey = {
	id: string;
	name: string;
	/** Present only in the response that created it. Never retrievable again. */
	key?: string;
};

const KEY_NAME = "Platform consumption";

export async function mintIntegrationKey(
	principal: Principal,
	input: { name?: string } = {},
): Promise<MintedIntegrationKey> {
	if (principal.kind !== "oauth") {
		throw new ServiceError(
			"FORBIDDEN",
			"Only a connected integration can mint a consumption key",
			403,
		);
	}

	// Reuse an existing live key rather than piling up one per click. A retried
	// enable should not leave the creator with five identical credentials.
	const existing = await db.query.apikey.findFirst({
		where: and(
			eq(apikey.referenceId, principal.creatorId),
			eq(apikey.name, input.name?.trim() || KEY_NAME),
			eq(apikey.enabled, true),
			isNull(apikey.expiresAt),
		),
	});
	if (existing) {
		// The secret was shown once and is not stored in the clear, so an existing
		// key cannot be returned. The caller is told to reuse what it has or
		// rotate; silently crafting a second key would hide that.
		throw new ServiceError(
			"KEY_EXISTS",
			"A consumption key already exists for this connection. Reuse it, or revoke it before minting another.",
			409,
			{ id: existing.id },
		);
	}

	// Imported lazily: `@/lib/auth` initialises Better Auth (and touches the
	// database) at module load, so a top-level import would make merely importing
	// this service require a live database — which breaks a skipped test and any
	// build-time analysis. Resolve it only when a key is actually minted.
	const { auth } = await import("@/lib/auth");
	const created = await auth.api.createApiKey({
		body: {
			name: input.name?.trim() || KEY_NAME,
			// Server-only field: the key belongs to the creator the OAuth token
			// acts for, not to whoever happened to be on the request.
			userId: principal.creatorId,
			permissions: { credits: ["consume"] },
		},
	});

	return { id: created.id, name: created.name ?? KEY_NAME, key: created.key };
}

/**
 * The keys this connection minted, without their secrets.
 *
 * Scoped to the caller's own creator, so one tenant can never enumerate
 * another's credentials.
 */
export async function listIntegrationKeys(principal: Principal) {
	if (principal.kind !== "oauth")
		throw new ServiceError(
			"FORBIDDEN",
			"Only a connected integration can list consumption keys",
			403,
		);
	const rows = await db.query.apikey.findMany({
		where: and(
			eq(apikey.referenceId, principal.creatorId),
			eq(apikey.name, KEY_NAME),
			eq(apikey.enabled, true),
		),
		columns: { id: true, name: true, start: true, createdAt: true },
	});
	return rows;
}

/**
 * Revoke a key this connection minted.
 *
 * Disabling the connection must be able to take the credential with it,
 * otherwise revoking access still leaves a working key that can spend credits.
 * Keys are matched on creator **and** name so a caller cannot delete a key it
 * did not mint.
 */
export async function revokeIntegrationKey(principal: Principal, id: string) {
	if (principal.kind !== "oauth")
		throw new ServiceError(
			"FORBIDDEN",
			"Only a connected integration can revoke consumption keys",
			403,
		);
	const [revoked] = await db
		.update(apikey)
		.set({ enabled: false })
		.where(
			and(
				eq(apikey.id, id),
				eq(apikey.referenceId, principal.creatorId),
				eq(apikey.name, KEY_NAME),
			),
		)
		.returning({ id: apikey.id });
	if (!revoked)
		throw new ServiceError("NOT_FOUND", "No such consumption key", 404);
	return { id: revoked.id, revoked: true };
}
