import { auth } from "@/lib/auth";
import { getCurrentSession } from "@/lib/auth-cached";

export type ActionResponse<T = any> = {
	success?: boolean;
	error?: string;
	data?: T;
	fieldErrors?: Record<string, string[]>;
};

/**
 * Wrapper for authenticated server actions.
 *
 * Uses React.cache() via getCurrentSession() for per-request auth deduplication.
 * This eliminates redundant auth calls when multiple server actions are called
 * in the same request (e.g., payouts page with 3-6 server action calls).
 */
export async function authenticatedAction<T>(
	action: (
		session: typeof auth.$Infer.Session,
		...args: any[]
	) => Promise<ActionResponse<T>>,
	...args: any[]
): Promise<ActionResponse<T>> {
	try {
		// Use cached session getter for per-request deduplication
		const session = await getCurrentSession();

		if (!session?.user) {
			return { error: "Unauthorized" };
		}

		return await action(session, ...args);
	} catch (error: any) {
		console.error("Action error:", error);
		return { error: error.message || "An unexpected error occurred" };
	}
}
