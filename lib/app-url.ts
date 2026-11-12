const PRODUCTION_URL = "https://litesubs.com";
const LOCAL_URL = "http://localhost:3000";

/**
 * Absolute base URL for the app, without a trailing slash.
 *
 * Never returns "undefined" — a missing NEXT_PUBLIC_APP_URL previously produced
 * URLs like "undefined/dashboard/payments", which silently broke every Stripe
 * return_url / refresh_url (Connect onboarding dead-ended). Prefer an explicit
 * env var, fall back to localhost in development, and to the production domain
 * otherwise.
 */
export function getAppUrl(): string {
	const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
	if (configured) {
		return configured.replace(/\/+$/, "");
	}

	return process.env.NODE_ENV === "development" ? LOCAL_URL : PRODUCTION_URL;
}

/** Build an absolute URL for a path within the app. */
export function appUrl(path = "/"): string {
	const normalized = path.startsWith("/") ? path : `/${path}`;
	return `${getAppUrl()}${normalized}`;
}
