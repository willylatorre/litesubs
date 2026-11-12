/**
 * Where the vendored auth UI sends people. The library defaults settings to
 * `/settings`, which this app does not serve; settings live under the dashboard
 * where the auth proxy already guards them.
 *
 * Both `/dashboard/account` and `/dashboard/security` render the same settings
 * page, which selects its tab from the path.
 */
export const dashboardBasePaths = {
	admin: "/dashboard/admin",
	auth: "/auth",
	settings: "/dashboard",
	organization: "/dashboard/organization",
};
