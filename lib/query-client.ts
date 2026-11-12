import { environmentManager, QueryClient } from "@tanstack/react-query";

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// Avoid refetching immediately on the client during hydration.
				staleTime: 5000,
			},
		},
	});
}

let browserQueryClient: QueryClient | undefined;

/**
 * One QueryClient per browser session, a fresh one per server render. Creating
 * a client during render would drop caches whenever React suspends.
 */
export function getQueryClient() {
	if (environmentManager.isServer()) return makeQueryClient();
	browserQueryClient ??= makeQueryClient();
	return browserQueryClient;
}
