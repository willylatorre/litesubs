import { notFound, redirect } from "next/navigation";
import { paymentPath } from "@/lib/public-links";
import { getCreatorUsername } from "@/lib/services/public-links";
import LegacyPayPage, { getPendingCheckout } from "../page";

/** Canonical payment-request URL; the token remains the single-use secret. */
export default async function CanonicalPayPage({
	params,
}: {
	params: Promise<{ username: string; token: string }>;
}) {
	const { username, token } = await params;
	const pending = await getPendingCheckout(token);
	if (!pending) notFound();

	const canonicalUsername = await getCreatorUsername(pending.creatorId);
	if (!canonicalUsername) notFound();
	if (username.toLowerCase() !== canonicalUsername) {
		redirect(paymentPath(canonicalUsername, token));
	}

	return (
		<LegacyPayPage
			params={Promise.resolve({ username: token })}
			canonicalized
			canonicalPath={paymentPath(canonicalUsername, token)}
		/>
	);
}
