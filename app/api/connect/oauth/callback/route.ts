import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { completeExistingAccountConnection } from "@/lib/services/connect";
import { ServiceError } from "@/lib/services/principal";

export const runtime = "nodejs";

/**
 * Stripe redirects here with `code` and `state` (or `error=access_denied`).
 *
 * Success and failure both land on the Payments screen with a reason. Nothing
 * secret is echoed back: only a short code, never the authorization code or
 * the state value.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	const error = url.searchParams.get("error");

	const back = (status: string) =>
		redirect(appUrl(`/dashboard/payments?connect=${status}`));

	// The user cancelled at Stripe. Recoverable, not an error state.
	if (error) return back(error === "access_denied" ? "denied" : "failed");
	if (!state || !code) return back("invalid");

	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		// Never complete another user's connection just because they opened the
		// callback URL while signed out.
		redirect(
			`/auth/sign-in?callbackURL=${encodeURIComponent("/dashboard/payments")}`,
		);
	}

	try {
		const result = await completeExistingAccountConnection({
			creatorId: session.user.id,
			state,
			code,
		});
		if (!result.compatible) return back("incompatible");
		return back("complete");
	} catch (caught) {
		if (caught instanceof ServiceError) {
			if (caught.code === "ACCOUNT_SWITCH_UNSUPPORTED")
				return back("switch_unsupported");
			if (caught.code === "OAUTH_STATE_INVALID") return back("invalid");
			return back("failed");
		}
		throw caught;
	}
}
