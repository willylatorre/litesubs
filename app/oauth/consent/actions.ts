"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function submitConsent(
	_state: { error?: string },
	form: FormData,
): Promise<{ error?: string }> {
	const oauthQuery = form.get("oauth_query");
	if (typeof oauthQuery !== "string")
		return {
			error:
				"This authorization request is invalid. Reconnect from your MCP client.",
		};
	let destination: string;
	try {
		const result = await auth.api.oauth2Consent({
			headers: await headers(),
			body: { accept: form.get("accept") === "true", oauth_query: oauthQuery },
		});
		destination = result.url;
	} catch {
		return {
			error:
				"Authorization could not be completed. Reconnect from your MCP client.",
		};
	}
	redirect(destination);
}
