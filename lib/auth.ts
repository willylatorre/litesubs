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
 * Platform billing: the creator paying Litesubs, not a creator's customer paying
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
 * pay Litesubs. The checkout path creates one lazily, which is the only moment
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
		subscription: {
			enabled: true,
			plans: [{ name: "premium", priceId: premiumPriceId }],
			// No balance or tier is written from these hooks. Entitlement is derived
			// from the subscription row by `lib/services/entitlements.ts`, so there
			// is exactly one interpretation of what a creator is entitled to.
		},
	});
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
			rateLimit: { enabled: true, timeWindow: 60000, maxRequests: 1000 },
			permissions: {
				// Machine keys start at the minimum: consume credits only.
				defaultPermissions: { credits: ["consume"] },
			},
		}),

		// Platform billing (creator -> Litesubs). Creator sales are a different
		// domain: direct charges on each creator's connected account, handled by
		// `/api/webhooks/stripe`, never here.
		...(() => {
			const billing = platformBilling();
			return billing ? [billing] : [];
		})(),
		nextCookies(),
	], // make sure this is the last plugin in the array
});
