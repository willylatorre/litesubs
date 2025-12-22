import { stripeClient } from "@better-auth/stripe/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: process.env.BETTER_AUTH_URL,
	plugins: [
		stripeClient({
			subscription: false, //if you want to enable subscription management
		}),
	],
	/** The base URL of the server (optional if you're using the same domain) */
	// baseURL: "http://localhost:3000"
});
