import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, get as httpGet } from "node:http";
import { buffer } from "node:stream/consumers";
import { test } from "node:test";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";

test("OAuth consent, PKCE and resource-bound tokens work through the remote MCP route", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	let base = "";
	let handle: (request: Request) => Promise<Response> = async () =>
		new Response(null, { status: 503 });
	const server = createServer(async (incoming, outgoing) => {
		try {
			const headers = new Headers();
			for (const [key, value] of Object.entries(incoming.headers))
				if (value !== undefined)
					for (const entry of Array.isArray(value) ? value : [value])
						headers.append(key, entry);
			const method = incoming.method ?? "GET";
			const request = new Request(new URL(incoming.url ?? "/", base), {
				method,
				headers,
				...(method === "GET" || method === "HEAD"
					? {}
					: { body: await buffer(incoming) }),
			});
			const response = await handle(request);
			outgoing.writeHead(response.status, {
				...Object.fromEntries(response.headers),
				...(response.headers.getSetCookie().length
					? { "set-cookie": response.headers.getSetCookie() }
					: {}),
			});
			outgoing.end(Buffer.from(await response.arrayBuffer()));
		} catch (error) {
			outgoing.writeHead(500);
			outgoing.end(String(error));
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	base = `http://127.0.0.1:${address.port}`;
	process.env.BETTER_AUTH_URL = base;
	process.env.NEXT_PUBLIC_APP_URL = base;
	process.env.MCP_RESOURCE_URL = `${base}/api/mcp`;
	// Test-only stable key encryption secret for repeat runs on the same test DB.
	process.env.BETTER_AUTH_SECRET ??=
		"litesubs-integration-test-only-key-encryption-secret";
	const { auth } = await import("@/lib/auth");
	const { POST } = await import("@/app/api/mcp/route");
	const { db } = await import("@/app/db");
	const { user, oauthClient, oauthClientResource, oauthResource } =
		await import("@/app/db/schema");
	handle = (request) =>
		new URL(request.url).pathname === "/api/mcp"
			? POST(request)
			: auth.handler(request);
	const clientId = crypto.randomUUID();
	let userId: string | undefined;
	try {
		const signup = await fetch(`${base}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: base },
			body: JSON.stringify({
				email: `${crypto.randomUUID()}@example.test`,
				name: "OAuth test",
				password: randomBytes(24).toString("base64url"),
			}),
		});
		const signupData = await signup.json();
		assert.equal(signup.status, 200, JSON.stringify(signupData));
		userId = signupData.user.id;
		const cookie = signup.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		assert.ok(cookie);
		const callback = `${base}/callback`;
		// A registered public-client fixture. The live OAuth endpoints below,
		// not a mock, own validation, consent, code issuance and token signing.
		await db.insert(oauthClient).values({
			id: clientId,
			clientId,
			name: "Test MCP client",
			scopes: ["plans:read", "offline_access"],
			redirectUris: [callback],
			grantTypes: ["authorization_code", "refresh_token"],
			responseTypes: ["code"],
			tokenEndpointAuthMethod: "none",
			applicationType: "native",
			requirePKCE: true,
		});
		await db.insert(oauthClientResource).values({
			id: crypto.randomUUID(),
			clientId,
			resourceId: `${base}/api/mcp`,
		});
		const verifier = randomBytes(32).toString("base64url");
		const state = crypto.randomUUID();
		const query = new URLSearchParams({
			client_id: clientId,
			response_type: "code",
			redirect_uri: callback,
			scope: "plans:read offline_access",
			resource: `${base}/api/mcp`,
			state,
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
		});
		// Node fetch stamps sec-fetch-mode=cors; use plain HTTP for the browser
		// navigation leg so the real provider returns a Location redirect.
		const authorization = await new Promise<{
			status: number;
			location: string;
			body: string;
		}>((resolve, reject) => {
			const request = httpGet(
				`${base}/api/auth/oauth2/authorize?${query}`,
				{
					headers: {
						cookie,
						accept: "text/html",
						"sec-fetch-mode": "navigate",
					},
				},
				(response) => {
					let body = "";
					response.on("data", (chunk) => {
						body += chunk;
					});
					response.on("end", () =>
						resolve({
							status: response.statusCode ?? 0,
							location: response.headers.location ?? "",
							body,
						}),
					);
				},
			);
			request.on("error", reject);
		});
		assert.equal(authorization.status, 302, authorization.body);
		const consentUrl = new URL(authorization.location, base);
		assert.equal(consentUrl.pathname, "/oauth/consent");
		const signed = new Set([
			"sig",
			"ba_param",
			...consentUrl.searchParams.getAll("ba_param"),
		]);
		const oauth_query = new URLSearchParams(
			[...consentUrl.searchParams].filter(([key]) => signed.has(key)),
		).toString();
		const tampered = new URLSearchParams(oauth_query);
		tampered.set("state", "changed-after-authorization");
		const tamperedConsent = await fetch(`${base}/api/auth/oauth2/consent`, {
			method: "POST",
			headers: { cookie, origin: base, "content-type": "application/json" },
			body: JSON.stringify({ accept: true, oauth_query: tampered.toString() }),
		});
		const tamperedResult = await tamperedConsent.json();
		assert.equal(tamperedConsent.status, 400, JSON.stringify(tamperedResult));
		assert.equal(
			tamperedResult.error,
			"invalid_signature",
			JSON.stringify(tamperedResult),
		);
		const consent = await fetch(`${base}/api/auth/oauth2/consent`, {
			method: "POST",
			headers: { cookie, origin: base, "content-type": "application/json" },
			body: JSON.stringify({ accept: true, oauth_query }),
			redirect: "manual",
		});
		const consentData = await consent.json();
		assert.equal(consent.status, 200, JSON.stringify(consentData));
		const redirect = new URL(consentData.url);
		assert.equal(redirect.searchParams.get("state"), state);
		const code = redirect.searchParams.get("code");
		assert.ok(code);
		const token = await fetch(`${base}/api/auth/oauth2/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: clientId,
				code,
				redirect_uri: callback,
				code_verifier: verifier,
				resource: `${base}/api/mcp`,
			}),
		});
		const tokens = await token.json();
		assert.equal(token.status, 200, JSON.stringify(tokens));
		assert.deepEqual(
			new Set(tokens.scope.split(" ")),
			new Set(["plans:read", "offline_access"]),
		);
		assert.equal(typeof tokens.refresh_token, "string");
		const refreshed = await fetch(`${base}/api/auth/oauth2/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				client_id: clientId,
				refresh_token: tokens.refresh_token,
				resource: `${base}/api/mcp`,
			}),
		});
		const rotated = await refreshed.json();
		assert.equal(refreshed.status, 200, JSON.stringify(rotated));
		assert.notEqual(rotated.refresh_token, tokens.refresh_token);
		const response = await fetch(`${base}/api/mcp`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${tokens.access_token}`,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": "2026-07-28",
				"Mcp-Method": "tools/call",
				"Mcp-Name": "list_plans",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "list_plans",
					arguments: {},
					_meta: {
						[PROTOCOL_VERSION_META_KEY]: "2026-07-28",
						[CLIENT_CAPABILITIES_META_KEY]: {},
						[CLIENT_INFO_META_KEY]: { name: "oauth-test", version: "1" },
					},
				},
			}),
		});
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.ok(!result.result.isError, JSON.stringify(result));
		assert.deepEqual(JSON.parse(result.result.content[0].text), []);
		const denied = await fetch(`${base}/api/mcp`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${tokens.access_token}`,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": "2026-07-28",
				"Mcp-Method": "tools/call",
				"Mcp-Name": "create_plan",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: {
					name: "create_plan",
					arguments: { name: "Not allowed", price: 10, credits: 1 },
					_meta: {
						[PROTOCOL_VERSION_META_KEY]: "2026-07-28",
						[CLIENT_CAPABILITIES_META_KEY]: {},
						[CLIENT_INFO_META_KEY]: { name: "oauth-test", version: "1" },
					},
				},
			}),
		});
		const deniedResult = await denied.json();
		assert.equal(denied.status, 200, JSON.stringify(deniedResult));
		assert.equal(deniedResult.result.isError, true);
		assert.equal(
			JSON.parse(deniedResult.result.content[0].text).code,
			"INSUFFICIENT_SCOPE",
		);
	} finally {
		await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId));
		if (userId) await db.delete(user).where(eq(user.id, userId));
		await db
			.delete(oauthResource)
			.where(eq(oauthResource.identifier, `${base}/api/mcp`));
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		await db.$client.end();
	}
});
