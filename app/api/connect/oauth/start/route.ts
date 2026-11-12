import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { errorResponse } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { startExistingAccountConnection } from "@/lib/services/connect";
import { ServiceError } from "@/lib/services/principal";

export const runtime = "nodejs";

/**
 * Begin connecting an existing Stripe account.
 *
 * A session-authenticated GET is safe here: it only reads and redirects, and
 * the actual attachment happens on the callback, which validates a single-use
 * state bound to this user.
 */
export async function GET() {
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user)
			return Response.redirect(
				new URL(
					"/auth/sign-in",
					process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
				),
				302,
			);

		const { url } = await startExistingAccountConnection(session.user.id);
		redirect(url);
	} catch (error) {
		if (
			error instanceof ServiceError &&
			error.code === "ACCOUNT_SWITCH_UNSUPPORTED"
		)
			return Response.redirect(
				new URL(
					"/dashboard/payments?connect=switch_unsupported",
					process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
				),
				302,
			);
		return errorResponse(error);
	}
}
