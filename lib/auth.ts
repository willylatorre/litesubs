import crypto from "node:crypto";
import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { stripe } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt, username } from "better-auth/plugins";
import Stripe from "stripe";
import { db } from "@/app/db"; // your drizzle instance
import { requirePremiumForApiKeys } from "@/lib/auth/premium-api-key-gate";
import { mcpResource } from "@/lib/mcp-config";
import {
	creatorForStripeSubscription,
	refreshPaidThrough,
} from "@/lib/services/platform-billing";
import { CREATOR_SCOPES } from "@/lib/services/principal";

const buildPhases = new Set(["phase-production-build", "phase-export"]);
const isBuildTime = buildPhases.has(process.env.NEXT_PHASE ?? "");

/**
 * Non-production origins. Only ever spread into `trustedOrigins` when
 * NODE_ENV !== "production", so a leftover dev host cannot be trusted in prod.
 */
const devOrigins = [
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"https://legendary-palm-tree-4qx6j57x66hg56-3000.app.github.dev",
	"https://3000-firebase-litesubs-1766156519822.cluster-kizalrzg35hz6u4i7pguwgt6ss.cloudworkstations.dev",
];

const betterAuthSecret =
	process.env.BETTER_AUTH_SECRET ??
	(isBuildTime || process.env.NODE_ENV !== "production"
		? crypto.randomBytes(32).toString("hex")
		: undefined);

if (
	!process.env.BETTER_AUTH_SECRET &&
	!isBuildTime &&
	process.env.NODE_ENV !== "production"
) {
	console.warn(
		"[better-auth] BETTER_AUTH_SECRET is not set. Using a temporary random secret for this process.",
	);
}

/**
 * Platform billing: the creator paying liteSubs, not a creator's customer paying
 * the creator. Those are separate domains with separate Stripe accounts — see
 * `docs/PLATFORM-BILLING.md`.
 *
 * The plugin is registered **only when a price and webhook secret exist**. A
 * plan with no `priceId` throws at checkout with a generic Stripe message; not
 * registering the plugin fails visibly at config time instead, and leaves the
 * rest of the app working on the free tier.
 *
 * `createCustomerOnSignUp` is deliberately off. Every buyer here is also a user,
 * so enabling it would mint a platform Stripe Customer for people who will never
 * pay liteSubs. The checkout path creates one lazily, which is the only moment
 * it is actually needed.
 */
const premiumPriceId = process.env.STRIPE_PREMIUM_PRICE_ID?.trim();
const billingWebhookSecret = process.env.STRIPE_WEBHOOK_BILLING?.trim();

function platformBilling() {
	if (
		!premiumPriceId ||
		!billingWebhookSecret ||
		!process.env.STRIPE_SECRET_KEY
	)
		return null;
	const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
		apiVersion: "2026-10-28.endive",
		typescript: true,
	});
	return stripe({
		stripeClient,
		stripeWebhookSecret: billingWebhookSecret,
		createCustomerOnSignUp: false,
		/**
		 * Runs **after** the plugin has written its own row for every event type.
		 *
		 * It exists for one reason: the plugin copies `current_period_end` into
		 * `periodEnd`, and Stripe advances that at period *start*, before payment.
		 * A renewal that then fails leaves `periodEnd` pointing at a month nobody
		 * paid for. We therefore resolve the real paid boundary from invoice
		 * history here and store it separately; `entitlements.ts` reads that.
		 *
		 * Errors are logged, not thrown: failing the webhook would make Stripe
		 * retry an event whose subscription write already succeeded, and the next
		 * lifecycle event repairs the boundary anyway.
		 */
		onEvent: async (event) => {
			const stripeSubscriptionId = subscriptionIdFromEvent(event);
			if (!stripeSubscriptionId) return;
			try {
				const creatorId =
					await creatorForStripeSubscription(stripeSubscriptionId);
				if (!creatorId) return;
				await refreshPaidThrough(creatorId);
			} catch (error) {
				console.error("Platform billing: paid-through refresh failed", {
					eventId: event.id,
					type: event.type,
					stripeSubscriptionId,
					error: error instanceof Error ? error.message : "UnknownError",
				});
			}
		},
		subscription: {
			enabled: true,
			plans: [{ name: "premium", priceId: premiumPriceId }],
			// No balance or tier is written from these hooks. Entitlement is derived
			// from the subscription row by `lib/services/entitlements.ts`, so there
			// is exactly one interpretation of what a creator is entitled to.
		},
	});
}

/** The platform subscription an event is about, or `null` for other events. */
function subscriptionIdFromEvent(event: Stripe.Event): string | null {
	const object = event.data.object as {
		object?: string;
		id?: string;
		subscription?: string | { id: string } | null;
		parent?: {
			subscription_details?: {
				subscription?: string | { id: string } | null;
			} | null;
		} | null;
	};
	if (object.object === "subscription") return object.id ?? null;
	if (object.object === "invoice") {
		const fromParent = object.parent?.subscription_details?.subscription;
		if (fromParent)
			return typeof fromParent === "string" ? fromParent : fromParent.id;
		const legacy = object.subscription;
		return legacy ? (typeof legacy === "string" ? legacy : legacy.id) : null;
	}
	if (
		object.object === "checkout.session" &&
		event.type.startsWith("checkout.session.")
	) {
		const legacy = object.subscription;
		return legacy ? (typeof legacy === "string" ? legacy : legacy.id) : null;
	}
	return null;
}

/**
 * Scopes exposed by the MCP surface. Kept here (not in lib/services) because
 * better-auth needs them at config time, and lib/services must stay free of
 * auth imports.
 *
 * `credits:consume` is API-key only and is never grantable through OAuth.
 */
export const MCP_SCOPES = CREATOR_SCOPES;

export type McpScope = (typeof MCP_SCOPES)[number];
const oauthScopes = [
	"openid",
	"profile",
	"email",
	"offline_access",
	...MCP_SCOPES,
];

/**
 * Protected resource identifier carried as the access token `aud`.
 * Must be an absolute HTTPS URL with no query or fragment (HTTP is allowed
 * only on loopback), per RFC 9728.
 */
export const auth = betterAuth({
	// The MCP profile requires that the JWT plugin's `/token` route is disabled:
	// session JWTs share a signing key with access tokens, so a resource server
	// checking only issuer + audience could otherwise accept a session JWT as a
	// bearer access token.
	disabledPaths: ["/token"],
	database: drizzleAdapter(db, {
		provider: "pg", // or "mysql", "sqlite"
	}),
	secret: betterAuthSecret,
	emailAndPassword: {
		enabled: true,
	},
	baseURL: process.env.BETTER_AUTH_URL,
	socialProviders: {
		google: {
			enabled: true,
			prompt: "select_account",
			clientId: process.env.GOOGLE_CLIENT_ID as string,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
		},
	},
	hooks: {
		// Tier gates live in front of Better Auth's own endpoints, so a rule cannot
		// be bypassed by calling the plugin API directly instead of the dashboard.
		before: requirePremiumForApiKeys,
	},
	// Development-only origins must never be trusted in production: a wildcard
	// in a Server Action origin list lets any Codespaces host call actions.
	trustedOrigins:
		process.env.NODE_ENV === "production"
			? ["https://litesubs.com", "https://www.litesubs.com"]
			: ["https://litesubs.com", "https://www.litesubs.com", ...devOrigins],

	plugins: [
		username({
			// One stable identity for every public link. Existing users may choose
			// their first username; after that, changing it would strand shared URLs.
			immutableUsername: true,
			displayUsername: false,
			minUsernameLength: 3,
			maxUsernameLength: 30,
			usernameValidator: (value) =>
				/^[a-zA-Z0-9_.]+$/.test(value) &&
				// Twelve characters are reserved for pre-username account handles.
				// Better Auth ids are not always UUIDs, so this is not hex-only.
				value.length !== 12,
		}),

		// Required by @better-auth/mcp: provides the signing key and /jwks.
		jwt({ disableSettingJwtHeader: true }),

		mcp({
			loginPage: "/auth/sign-in",
			consentPage: "/oauth/consent",
			resource: mcpResource,
			// Validated scopes...
			scopes: oauthScopes,
			// ...and the same list advertised to clients in discovery.
			advertisedMetadata: { scopes_supported: oauthScopes },
			refreshTokenReuseInterval: 0,
			grantTypes: ["authorization_code", "refresh_token"],
			clientPrivileges: () => false,
			resourcePrivileges: () => false,
		}),
		cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),

		apiKey({
			// DANGER: never enable. A key would become a full creator session,
			// collapsing the scope model. Keep false and keep this comment.
			enableSessionForAPIKeys: false,
			defaultPrefix: "ls_",
			/**
			 * Metadata is where a key records **who minted it**. The integration
			 * path stores an ownership marker there so a key can be listed and
			 * revoked regardless of the display name its caller chose. Names are
			 * labels, not identity: matching on them both refused a legitimate mint
			 * when a creator had a same-named dashboard key, and hid a
			 * caller-renamed key from the connection that owned it.
			 *
			 * Metadata is not a permission: it never widens a key's scopes, which
			 * come from `permissions` and are read by `apiKeyPrincipal`.
			 */
			enableMetadata: true,
			rateLimit: { enabled: true, timeWindow: 60000, maxRequests: 1000 },
			permissions: {
				// Machine keys start at the minimum: consume credits only.
				defaultPermissions: { credits: ["consume"] },
			},
		}),

		// Platform billing (creator -> liteSubs). Creator sales are a different
		// domain: direct charges on each creator's connected account, handled by
		// `/api/webhooks/stripe`, never here.
		...(() => {
			const billing = platformBilling();
			return billing ? [billing] : [];
		})(),
		nextCookies(),
	], // make sure this is the last plugin in the array
});
