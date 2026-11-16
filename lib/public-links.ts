/**
 * Canonical public URLs. The creator is always their normalized username;
 * schedule slugs and opaque invite/payment tokens remain the resource segment.
 */
export function bookingPath(username: string, slug: string) {
	return `/book/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
}

export function invitePath(username: string, token: string) {
	return `/invite/${encodeURIComponent(username)}/${encodeURIComponent(token)}`;
}

export function paymentPath(username: string, token: string) {
	return `/pay/${encodeURIComponent(username)}/${encodeURIComponent(token)}`;
}
