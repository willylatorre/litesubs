import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import { liteSubscriptions, transactions, user } from "@/app/db/schema";
import { changeCredits } from "@/lib/services/credits";
import { getCustomer, listCustomers } from "@/lib/services/customers";
import { claimEnrollmentInvite, enrollCustomer } from "@/lib/services/enroll";
import { createPlan } from "@/lib/services/plans";
import { type Principal, sessionPrincipal } from "@/lib/services/principal";

// Run only against an explicitly provisioned test database; never use .env's DB.
test("MCP services preserve tenant boundaries and credit invariants", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID(),
		otherId = crypto.randomUUID(),
		studentId = crypto.randomUUID();
	const principal = sessionPrincipal(creatorId);
	const machine: Principal = {
		kind: "apiKey",
		creatorId,
		scopes: ["credits:consume"],
	};
	const studentEmail = `${studentId}@example.test`;
	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: otherId, name: "Other creator", email: `${otherId}@example.test` },
		{ id: studentId, name: "Student", email: studentEmail },
	]);
	try {
		const plan = await createPlan(principal, {
			name: "Algebra",
			price: 10,
			credits: 10,
		});
		await enrollCustomer(principal, {
			plan: plan.id,
			customer: studentEmail,
			mode: "comp",
			reason: "Welcome",
		});
		const balance = async () =>
			(
				await db.query.liteSubscriptions.findFirst({
					where: and(
						eq(liteSubscriptions.userId, studentId),
						eq(liteSubscriptions.productId, plan.id),
					),
				})
			)?.credits;
		const spend = (key: string, amount = 3, dry_run = false) =>
			changeCredits(
				machine,
				{
					customer: studentEmail,
					plan: plan.id,
					amount,
					reason: "Lesson",
					idempotency_key: key,
					dry_run,
				},
				"usage",
			);
		await t.test(
			"concurrent retries debit exactly once and preserve original receipt",
			async () => {
				const [a, b] = await Promise.all([
					spend("lesson-1"),
					spend("lesson-1"),
				]);
				assert.equal(a.transactionId, b.transactionId);
				assert.equal(a.before, 10);
				assert.equal(a.after, 7);
				assert.equal(await balance(), 7);
				await assert.rejects(spend("lesson-1", 4), {
					code: "IDEMPOTENCY_CONFLICT",
				});
			},
		);
		await t.test(
			"dry runs do not reserve keys or write balances/ledger",
			async () => {
				const result = await spend("preview", 2, true);
				assert.equal(result.after, 5);
				assert.equal(result.transactionId, null);
				assert.equal(await balance(), 7);
				assert.equal(
					(
						await db
							.select()
							.from(transactions)
							.where(
								and(
									eq(transactions.creatorId, creatorId),
									eq(transactions.idempotencyKey, "preview"),
								),
							)
					).length,
					0,
				);
			},
		);
		await t.test("concurrent independent debits cannot overdraw", async () => {
			const results = await Promise.allSettled([
				spend("lesson-2", 5),
				spend("lesson-3", 5),
			]);
			assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
			assert.equal(await balance(), 2);
		});
		await t.test(
			"tenant and credential boundaries hold at service entry points",
			async () => {
				assert.deepEqual(await listCustomers(sessionPrincipal(otherId)), []);
				await assert.rejects(
					getCustomer(sessionPrincipal(otherId), studentId),
					{ code: "NOT_FOUND" },
				);
				await assert.rejects(
					createPlan(machine, { name: "Forbidden", price: 10, credits: 1 }),
					{ code: "FORBIDDEN" },
				);
				await assert.rejects(
					changeCredits(
						{ ...principal, kind: "oauth" },
						{
							customer: studentEmail,
							plan: plan.id,
							amount: 1,
							reason: "Lesson",
							idempotency_key: "oauth",
						},
						"usage",
					),
					{ code: "FORBIDDEN" },
				);
				await assert.rejects(
					changeCredits(
						machine,
						{
							customer: studentEmail,
							plan: plan.id,
							amount: 1,
							reason: "Lesson",
						},
						"usage",
					),
					{ code: "IDEMPOTENCY_REQUIRED" },
				);
			},
		);
		await t.test(
			"re-enrollment cannot double-comp and invite claim grants once",
			async () => {
				await assert.rejects(
					enrollCustomer(principal, {
						plan: plan.id,
						customer: studentEmail,
						mode: "comp",
						reason: "Welcome",
					}),
					{ code: "ALREADY_ENROLLED" },
				);
				const invitedId = crypto.randomUUID(),
					email = `${invitedId}@example.test`;
				const invite = await enrollCustomer(principal, {
					plan: plan.id,
					customer: email,
					mode: "comp",
					reason: "Trial",
				});
				assert.equal(invite.status, "invited");
				assert.ok("inviteUrl" in invite);
				const token = new URL(invite.inviteUrl).pathname.split("/").pop();
				assert.ok(token);
				await db.insert(user).values({ id: invitedId, name: "Invitee", email });
				try {
					const claims = await Promise.allSettled([
						claimEnrollmentInvite(invitedId, email, token),
						claimEnrollmentInvite(invitedId, email, token),
					]);
					assert.equal(
						claims.filter((c) => c.status === "fulfilled").length,
						1,
					);
					assert.equal(
						(await getCustomer(principal, invitedId)).subscriptions[0].credits,
						10,
					);
				} finally {
					await db.delete(user).where(eq(user.id, invitedId));
				}
			},
		);
		await t.test(
			"remote endpoint authenticates keys, restricts tools and exposes OAuth discovery",
			async () => {
				const { auth } = await import("@/lib/auth");
				const { POST } = await import("@/app/api/mcp/route");
				const { GET: discovery } = await import(
					"@/app/.well-known/[...path]/route"
				);
				const { GET: rest } = await import("@/app/api/v1/[...resource]/route");
				const key = await auth.api.createApiKey({
					body: {
						name: "Integration test",
						userId: creatorId,
						expiresIn: 86400,
					},
				});
				const request = (body: Record<string, unknown>, credential?: string) =>
					new Request("http://localhost:3000/api/mcp", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json, text/event-stream",
							"MCP-Protocol-Version": "2026-07-28",
							"Mcp-Method": String(body.method),
							...(body.method === "tools/call"
								? { "Mcp-Name": "consume_credits" }
								: {}),
							...(credential ? { "x-api-key": credential } : {}),
						},
						body: JSON.stringify({
							...body,
							params: {
								...(body.params as Record<string, unknown> | undefined),
								_meta: {
									[PROTOCOL_VERSION_META_KEY]: "2026-07-28",
									[CLIENT_INFO_META_KEY]: {
										name: "integration-test",
										version: "1",
									},
									[CLIENT_CAPABILITIES_META_KEY]: {},
								},
							},
						}),
					});
				try {
					const challenge = await POST(
						request({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
					);
					assert.equal(challenge.status, 401);
					assert.match(
						challenge.headers.get("www-authenticate") ?? "",
						/resource_metadata=/,
					);
					const response = await POST(
						request({ jsonrpc: "2.0", id: 2, method: "tools/list" }, key.key),
					);
					const payload = await response.json();
					assert.equal(response.status, 200, JSON.stringify(payload));
					assert.deepEqual(
						payload.result.tools.map((tool: { name: string }) => tool.name),
						["consume_credits"],
					);
					const call = await POST(
						request(
							{
								jsonrpc: "2.0",
								id: 3,
								method: "tools/call",
								params: {
									name: "consume_credits",
									arguments: {
										customer: studentEmail,
										plan: plan.id,
										amount: 1,
										reason: "Remote lesson",
										idempotency_key: "remote-lesson",
									},
								},
							},
							key.key,
						),
					);
					const result = await call.json();
					assert.equal(call.status, 200, JSON.stringify(result));
					assert.ok(!result.result.isError, JSON.stringify(result));
					assert.equal(JSON.parse(result.result.content[0].text).after, 1);
					assert.equal(await balance(), 1);
					const denied = await rest(
						new Request("http://localhost:3000/api/v1/plans", {
							headers: { "x-api-key": key.key },
						}),
						{ params: Promise.resolve({ resource: ["plans"] }) },
					);
					assert.equal(denied.status, 403);
					const metadata = await discovery(
						new Request(
							"http://localhost:3000/.well-known/oauth-protected-resource/api/mcp",
						),
					);
					assert.equal(metadata.status, 200);
					assert.ok(
						!(await metadata.json()).scopes_supported.includes(
							"credits:consume",
						),
					);
				} finally {
					await db
						.delete((await import("@/app/db/schema")).apikey)
						.where(eq((await import("@/app/db/schema")).apikey.id, key.id));
				}
			},
		);
	} finally {
		for (const id of [studentId, creatorId, otherId])
			await db.delete(user).where(eq(user.id, id));
		await db.$client.end();
	}
});
