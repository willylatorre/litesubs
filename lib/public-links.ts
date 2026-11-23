/**
 * Canonical public URLs. The creator is always their normalized username;
 * opaque invite/payment tokens remain the resource segment.
 */
export function invitePath(username: string, token: string) {
	return `/invite/${encodeURIComponent(username)}/${encodeURIComponent(token)}`;
}

export function paymentPath(username: string, token: string) {
	return `/pay/${encodeURIComponent(username)}/${encodeURIComponent(token)}`;
}
