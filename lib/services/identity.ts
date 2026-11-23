import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import { creatorTierEnum } from "@/app/db/entitlement-schema";
import { user } from "@/app/db/schema";
import { getEntitlement } from "./entitlements";
import { type Principal, ServiceError } from "./principal";

/**
 * Who is this credential acting as?
 *
 * Any integration needs this: a client holding a key knows the key, not the
 * account behind it, and a connection that cannot name its own tenant is the
 * grain of a cross-tenant bug. Sending it back to the client is the only way for
 * that client to label the connection honestly.
 *
 * Deliberately minimal. It returns the creator id, the account's display name,
 * the tier, and the scopes this key holds — nothing about customers, money or
 * plans, which have their own routes with their own scopes.
 */
export async function getIdentity(principal: Principal) {
	const [creator, entitlement] = await Promise.all([
		db.query.user.findFirst({
			where: eq(user.id, principal.creatorId),
			columns: { id: true, name: true },
		}),
		getEntitlement(principal.creatorId),
	]);

	// Fall back to the principal's own id: a creator may exist without a
	// platform subscription row, which is the normal free case.
	const account = creator ?? { id: principal.creatorId, name: null };

	return {
		creatorId: account.id,
		name: account.name,
		tier: entitlement.tier,
		tiers: creatorTierEnum.enumValues,
		/** What this specific credential may do, so a client can self-diagnose. */
		scopes: [...principal.scopes].sort(),
	};
}

/** Refuse a caller with no creator bound to its credential. */
export function assertHasCreator(principal: Principal) {
	if (!principal.creatorId)
		throw new ServiceError("UNAUTHORIZED", "This credential has no creator", 401);
}
