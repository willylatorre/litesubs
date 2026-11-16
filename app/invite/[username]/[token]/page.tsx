import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { invitePath } from "@/lib/public-links";
import LegacyInvitePage, {
	getInvite,
	generateMetadata as legacyGenerateMetadata,
} from "../page";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ username: string; token: string }>;
}): Promise<Metadata> {
	const { token } = await params;
	return legacyGenerateMetadata({
		params: Promise.resolve({ username: token }),
	});
}

/** Canonical invite URL; the opaque token still owns authorization. */
export default async function CanonicalInvitePage({
	params,
}: {
	params: Promise<{ username: string; token: string }>;
}) {
	const { username, token } = await params;
	const invite = await getInvite(token);
	if (!invite) notFound();

	const canonicalUsername = invite.creator.username;
	if (!canonicalUsername) notFound();
	if (username.toLowerCase() !== canonicalUsername) {
		redirect(invitePath(canonicalUsername, token));
	}

	return (
		<LegacyInvitePage
			params={Promise.resolve({ username: token })}
			canonicalized
		/>
	);
}
