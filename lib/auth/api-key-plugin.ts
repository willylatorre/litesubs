import { createAuthPlugin } from "@better-auth-ui/core";
import {
	type ApiKeyPluginOptions,
	apiKeyPlugin as coreApiKeyPlugin,
} from "@better-auth-ui/core/plugins/api-key";

import { ApiKeys } from "@/components/auth/api-key/api-keys";

/**
 * Registers the API-key card in the security settings. Organization-scoped keys
 * are not offered, so the core plugin's `organizationCards` branch is dropped
 * rather than left pointing at UI this app never renders.
 */
export const apiKeyPlugin = createAuthPlugin(
	coreApiKeyPlugin.id,
	(options: ApiKeyPluginOptions = {}) => ({
		...coreApiKeyPlugin(options),
		securityCards: [ApiKeys],
	}),
);
