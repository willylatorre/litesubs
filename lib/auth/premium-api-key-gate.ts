import { APIError, createAuthMiddleware } from "better-auth/api";
import { getEntitlement } from "@/lib/services/entitlements";

/**
 * Refuse API-key creation on a tier that does not include developer features.
 *
 * Better Auth owns `/api-key/create`, so the gate has to sit in front of its
 * endpoint rather than inside a service this repo calls. A middleware is the
 * only place that can see the path before the plugin handles it, which keeps
 * the rule true for *every* caller — the dashboard dialog, a script, or a
 * crafted request — instead of only the UI that happens to render the button.
 *
 * Free creators can still list and revoke keys they already hold: downgrading
 * must not lock anyone out of revoking a credential.
 */
export const requirePremiumForApiKeys = createAuthMiddleware(async (ctx) => {
	const path = ctx.path ?? "";
	if (!path.startsWith("/api-key/create")) return;

	const session = ctx.context.session;
	const userId = session?.user?.id;
	if (!userId) {
		// Better Auth would reject this anyway; let it produce its own error
		// rather than reporting a billing problem for an unauthenticated call.
		return;
	}

	const entitlement = await getEntitlement(userId);
	if (entitlement.canUseDeveloperFeatures) return;

	throw new APIError("PAYMENT_REQUIRED", {
		message: "API keys are a Premium feature. Upgrade to connect your own app.",
	});
});
