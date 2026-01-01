import { stripe as baStripe } from "@better-auth/stripe";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import crypto from "node:crypto";
import { db } from "@/app/db"; // your drizzle instance
import { getStripe } from "@/lib/stripe";

const buildPhases = new Set(["phase-production-build", "phase-export"]);
const isBuildTime = buildPhases.has(process.env.NEXT_PHASE ?? "");

const betterAuthSecret =
	process.env.BETTER_AUTH_SECRET ??
	((isBuildTime || process.env.NODE_ENV !== "production")
		? crypto.randomBytes(32).toString("hex")
		: undefined);

if (!process.env.BETTER_AUTH_SECRET && !isBuildTime && process.env.NODE_ENV !== "production") {
	console.warn(
		"[better-auth] BETTER_AUTH_SECRET is not set. Using a temporary random secret for this process."
	);
}

export const auth = betterAuth({
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
	trustedOrigins: [
		"https://litesubs.com",
		"https://legendary-palm-tree-4qx6j57x66hg56-3000.app.github.dev",
		"https://3000-firebase-litesubs-1766156519822.cluster-kizalrzg35hz6u4i7pguwgt6ss.cloudworkstations.dev",
		"http://localhost:3000",
	],

	plugins: [
		...(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
			? [
					baStripe({
						stripeClient: getStripe(),
						stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
						createCustomerOnSignUp: true,
					}),
				]
			: []),
		nextCookies(),
	], // make sure this is the last plugin in the array
});
