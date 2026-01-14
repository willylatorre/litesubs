import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Cached session getter - uses React.cache() for per-request deduplication.
 *
 * This is safe because React.cache() is per-request only:
 * - Each HTTP request gets a fresh cache
 * - Logout = new request = fresh auth state (returns null)
 * - Login = new request = fresh auth state (returns session)
 * - This is NOT like LRU caching that persists data
 *
 * Use this instead of calling auth.api.getSession directly in server actions
 * to eliminate redundant auth calls within the same request.
 */
export const getCurrentSession = cache(async () => {
	return auth.api.getSession({ headers: await headers() });
});
