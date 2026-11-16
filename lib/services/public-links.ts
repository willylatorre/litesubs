import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import { user } from "@/app/db/schema";
import { ServiceError } from "./principal";

/** A creator's stable public identity, if they have chosen one. */
export async function getCreatorUsername(creatorId: string) {
	const [row] = await db
		.select({ username: user.username })
		.from(user)
		.where(eq(user.id, creatorId))
		.limit(1);
	return row?.username ?? null;
}

/**
 * New shareable links require a username rather than silently falling back to
 * an account id. Existing links keep working through their legacy routes.
 */
export async function requireCreatorUsername(creatorId: string) {
	const username = await getCreatorUsername(creatorId);
	if (!username) {
		throw new ServiceError(
			"USERNAME_REQUIRED",
			"Choose a username in Account before creating public links",
			409,
		);
	}
	return username;
}
