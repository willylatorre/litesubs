"use client";

import type { ComponentProps } from "react";
import { ShareLinkActions } from "@/components/share-link-actions";
import { useOrigin } from "@/hooks/use-origin";
import { rehostUrl } from "@/lib/share-link";

/**
 * Share a liteSubs-owned URL on the host the creator is browsing.
 *
 * Invite and payment links come back absolute against NEXT_PUBLIC_APP_URL. On a
 * preview deployment that would hand a customer a production URL for a record
 * that only exists in the preview database, so the origin is replaced after
 * mount. Never use this for third-party URLs (e.g. Stripe Checkout).
 */
export function AppShareLinkActions({
	url,
	...props
}: Omit<ComponentProps<typeof ShareLinkActions>, "url"> & { url: string }) {
	const origin = useOrigin();

	return (
		<ShareLinkActions {...props} url={origin ? rehostUrl(url, origin) : url} />
	);
}
