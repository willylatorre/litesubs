import { usernamePlugin } from "@better-auth-ui/core/plugins/username";

/** Shared by auth pages and dashboard settings; their field sets must match. */
export function authUsernamePlugin() {
	return usernamePlugin({
		displayUsername: false,
		isUsernameAvailable: true,
		minUsernameLength: 3,
		maxUsernameLength: 30,
		usernamePrefix: "@",
		localization: {
			usernamePlaceholder: "e.g. john",
		},
	});
}
