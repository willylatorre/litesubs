import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export type ActionResponse<T = any> = {
	success?: boolean;
	error?: string;
	data?: T;
	fieldErrors?: Record<string, string[]>;
};

export async function authenticatedAction<T>(
	action: (
		session: typeof auth.$Infer.Session,
		...args: any[]
	) => Promise<ActionResponse<T>>,
	...args: any[]
): Promise<ActionResponse<T>> {
	try {
		const session = await auth.api.getSession({
			headers: await headers(),
		});

		if (!session?.user) {
			return { error: "Unauthorized" };
		}

		return await action(session, ...args);
	} catch (error: any) {
		console.error("Action error:", error);
		return { error: error.message || "An unexpected error occurred" };
	}
}
