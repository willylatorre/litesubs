import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { headers } from "next/headers";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { ConsentForm } from "./consent-form";

const scopeDescriptions: Record<string, string> = {
	openid: "Identify your account",
	profile: "Read your name",
	email: "Read your email address",
	offline_access: "Stay connected until access is revoked",
	"plans:read": "Read your plans",
	"plans:write": "Create and change your plans",
	"customers:read": "Read your customers and balances",
	"customers:write": "Enroll customers and grant credits",
	"billing:read": "Read your transaction history",
};

export default async function ConsentPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const values = await searchParams;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values))
		for (const entry of Array.isArray(value)
			? value
			: value === undefined
				? []
				: [value])
			params.append(key, entry);
	const signed = new Set(["sig", "ba_param", ...params.getAll("ba_param")]);
	const query = new URLSearchParams(
		[...params].filter(([key]) => signed.has(key)),
	).toString();
	const { secret } = await auth.$context;
	if (!(await verifyOAuthQueryParams(query, secret)))
		return (
			<main className="mx-auto max-w-lg space-y-4 px-6 py-16">
				<h1 className="text-2xl font-bold">
					Authorization request expired or invalid
				</h1>
				<p>
					Reconnect to Litesubs from your MCP client to start a new request.
				</p>
				<Link href="/dashboard" className="underline">
					Back to dashboard
				</Link>
			</main>
		);
	const verified = new URLSearchParams(query);
	const clientId = verified.get("client_id");
	if (!clientId)
		return (
			<main className="p-6">
				Missing client identifier. Reconnect from your MCP client.
			</main>
		);
	const client = await auth.api.getOAuthClientPublic({
		query: { client_id: clientId },
		headers: await headers(),
	});
	const callback = verified.get("redirect_uri");
	const callbackHost = callback
		? new URL(callback).host || new URL(callback).protocol
		: "the requesting application";
	const scopes = (verified.get("scope") ?? "").split(" ").filter(Boolean);
	return (
		<main className="mx-auto max-w-lg px-4 py-16">
			<Card>
				<CardHeader>
					<CardTitle className="text-2xl">Connect to Litesubs</CardTitle>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="space-y-2">
						<p className="break-words">
							<strong>{client.client_name ?? "An application"}</strong> is
							requesting access to your account.
						</p>
						<p className="break-all text-sm text-muted-foreground">
							You will return to {callbackHost}.
						</p>
					</div>
					<div className="space-y-3">
						<h2 className="font-semibold">Requested permissions</h2>
						<ul className="list-disc space-y-2 pl-5 text-sm">
							{scopes.map((scope) => (
								<li key={scope}>{scopeDescriptions[scope] ?? scope}</li>
							))}
						</ul>
					</div>
					<p className="text-sm text-muted-foreground">
						Only approve applications you trust. Write access can change plans
						and customer credit balances. This connection cannot issue payouts
						or refunds.
					</p>
					<ConsentForm query={query} />
				</CardContent>
			</Card>
		</main>
	);
}
