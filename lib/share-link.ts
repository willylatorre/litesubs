/**
 * Sharing a link should do whatever the device does best.
 *
 * On a phone that is the native share sheet (Messages, WhatsApp, AirDrop), which
 * is the only way a creator will actually get an invite in front of a customer.
 * On a desktop browser `navigator.share` is usually missing, so we fall back to
 * the clipboard. Callers get a single result they can turn into a toast.
 */
export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/**
 * Put a canonical app URL on the host the creator is actually browsing.
 *
 * The service builds absolute URLs from NEXT_PUBLIC_APP_URL, which is right for
 * API consumers but wrong on a preview deployment: an invite created there lives
 * in that deployment's database, so a production URL would 404. The path is the
 * server's canonical one; only the origin changes. Invalid input is returned
 * untouched rather than throwing in the middle of a share action.
 */
export function rehostUrl(url: string, origin: string): string {
	try {
		const parsed = new URL(url, origin);
		const target = new URL(origin);
		target.pathname = parsed.pathname;
		target.search = parsed.search;
		target.hash = parsed.hash;
		return target.toString();
	} catch {
		return url;
	}
}

export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

export async function shareLink({
	url,
	title,
	text,
}: {
	url: string;
	title?: string;
	text?: string;
}): Promise<ShareResult> {
	// Insecure origins and some embedded webviews expose `share` but reject it,
	// so a failure here is not final: try the clipboard before giving up.
	if (
		typeof navigator !== "undefined" &&
		typeof navigator.share === "function"
	) {
		try {
			await navigator.share({ url, title, text });
			return "shared";
		} catch (error) {
			// Dismissing the sheet is a decision, not an error: never copy behind
			// the user's back.
			if (error instanceof DOMException && error.name === "AbortError")
				return "cancelled";
		}
	}

	return (await copyToClipboard(url)) ? "copied" : "failed";
}
