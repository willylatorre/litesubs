import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: process.env.BETTER_AUTH_URL,
	plugins: [
		apiKeyClient(),
		oauthProviderClient(),
		usernameClient({ displayUsername: false }),
	],
	/** The base URL of the server (optional if you're using the same domain) */
	// baseURL: "http://localhost:3000"
});
