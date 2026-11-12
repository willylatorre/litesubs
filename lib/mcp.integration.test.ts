import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	creditGrants,
	enrollments,
	planVersions,
	transactions,
	user,
} from "@/app/db/schema";
import { changeCredits } from "@/lib/services/credits";
import { getCustomer, listCustomers } from "@/lib/services/customers";
import { claimEnrollmentInvite, enrollCustomer } from "@/lib/services/enroll";
import {
	createPlan,
	getPlan,
	listPlans,
	resolvePublishedPlan,
	updatePlan,
} from "@/lib/services/plans";
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
			terms: {
				billingMode: "one_time",
				currency: "usd",
				price: 10,
				credits: 10,
			},
		});
		// Publishing (and its Stripe provisioning) is a later slice; seed the
		// immutable terms directly so enrollment has a sellable version.
		await db
			.update(planVersions)
			.set({ status: "published", publishedAt: new Date() })
			.where(
				and(eq(planVersions.planId, plan.id), eq(planVersions.status, "draft")),
			);
		await enrollCustomer(principal, {
			plan: plan.id,
			customer: studentEmail,
			mode: "comp",
			reason: "Welcome",
		});
		const balance = async () =>
			(
				await db.query.enrollments.findFirst({
					where: and(
						eq(enrollments.userId, studentId),
						eq(enrollments.planId, plan.id),
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
			"drafts are unsellable and keep editable terms separate from publication",
			async () => {
				const draft = await createPlan(principal, {
					name: "Draft monthly",
					terms: {
						billingMode: "recurring",
						currency: "eur",
						price: 25,
						credits: 5,
						interval: "month",
					},
				});
				assert.equal(draft.isDraft, true);
				assert.equal(draft.terms?.status, "draft");
				assert.equal(draft.terms?.price, 2500);
				assert.equal(draft.terms?.interval, "month");

				// No transport can purchase, enroll, or invite into a draft.
				for (const attempt of [
					() =>
						enrollCustomer(principal, {
							plan: draft.id,
							customer: studentEmail,
							mode: "comp",
							reason: "Draft attempt",
						}),
					() => resolvePublishedPlan(creatorId, draft.id),
				])
					await assert.rejects(attempt, { code: "PLAN_NOT_PUBLISHED" });

				// Editing replaces the working copy, not a frozen version.
				const updated = await updatePlan(principal, draft.id, {
					name: "Draft monthly renamed",
					terms: {
						billingMode: "recurring",
						currency: "eur",
						price: 30,
						credits: 8,
						interval: "month",
					},
				});
				assert.equal(updated.name, "Draft monthly renamed");
				assert.equal(updated.terms?.credits, 8);
				// A partial terms patch must not inject defaults that flip the
				// billing mode back to one-time.
				const patched = await updatePlan(principal, draft.id, {
					terms: {
						billingMode: "recurring",
						currency: "eur",
						price: 30,
						credits: 9,
						interval: "month",
					},
				});
				assert.equal(patched.terms?.billingMode, "recurring");
				assert.equal(patched.terms?.interval, "month");
				assert.equal(patched.terms?.credits, 9);
				assert.equal(
					(
						await db.query.planVersions.findMany({
							where: and(
								eq(planVersions.planId, draft.id),
								eq(planVersions.status, "draft"),
							),
						})
					).length,
					1,
				);

				// Invalid term combinations fail instead of silently coercing.
				await assert.rejects(
					createPlan(principal, {
						name: "Yearly attempt",
						terms: { billingMode: "recurring", price: 10, credits: 1 },
					}),
				);

				// Tenant isolation: another creator cannot read or edit it.
				await assert.rejects(getPlan(sessionPrincipal(otherId), draft.id), {
					code: "NOT_FOUND",
				});
				assert.deepEqual(await listPlans(sessionPrincipal(otherId)), []);
			},
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
					createPlan(machine, {
						name: "Forbidden",
						terms: {
							billingMode: "one_time",
							currency: "usd",
							price: 10,
							credits: 1,
						},
					}),
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
						(await getCustomer(principal, invitedId)).enrollments[0].credits,
						10,
					);
				} finally {
					await db.delete(user).where(eq(user.id, invitedId));
				}
			},
		);
		await t.test(
			"complimentary credits carry an expiry that the claim honours",
			async () => {
				// A recurring comp has no paid period to inherit, so it must state
				// its expiry instead of creating a permanently free allowance.
				const monthly = await createPlan(principal, {
					name: "Monthly bonus",
					terms: {
						billingMode: "recurring",
						interval: "month",
						currency: "usd",
						price: 10,
						credits: 4,
					},
				});
				await db
					.update(planVersions)
					.set({ status: "published", publishedAt: new Date() })
					.where(
						and(
							eq(planVersions.planId, monthly.id),
							eq(planVersions.status, "draft"),
						),
					);
				await assert.rejects(
					enrollCustomer(principal, {
						plan: monthly.id,
						customer: studentEmail,
						mode: "comp",
						reason: "No period yet",
					}),
					{ code: "EXPIRY_REQUIRED" },
				);

				const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
				const invitedId = crypto.randomUUID();
				const email = `${invitedId}@example.test`;
				const invite = await enrollCustomer(principal, {
					plan: monthly.id,
					customer: email,
					mode: "comp",
					reason: "Trial month",
					expires_at: expiry,
				});
				assert.equal(invite.status, "invited");
				assert.ok("inviteUrl" in invite && "creditsExpireAt" in invite);
				const token = new URL(invite.inviteUrl).pathname.split("/").pop();
				assert.ok(token);
				await db.insert(user).values({ id: invitedId, name: "Trial", email });
				try {
					await claimEnrollmentInvite(invitedId, email, token);
					const [enrollment] = await db
						.select()
						.from(enrollments)
						.where(
							and(
								eq(enrollments.userId, invitedId),
								eq(enrollments.planId, monthly.id),
							),
						);
					const [grant] = await db.query.creditGrants.findMany({
						where: eq(creditGrants.enrollmentId, enrollment.id),
					});
					assert.equal(grant.kind, "comp");
					assert.equal(grant.expiresAt?.getTime(), expiry.getTime());
				} finally {
					await db.delete(user).where(eq(user.id, invitedId));
				}
			},
		);
		await t.test(
			"an invite cannot claim terms that replaced the ones it offered",
			async () => {
				const priced = await createPlan(principal, {
					name: "Repriced pack",
					terms: {
						billingMode: "one_time",
						currency: "usd",
						price: 10,
						credits: 10,
					},
				});
				await db
					.update(planVersions)
					.set({ status: "published", publishedAt: new Date() })
					.where(
						and(
							eq(planVersions.planId, priced.id),
							eq(planVersions.status, "draft"),
						),
					);
				const invitedId = crypto.randomUUID();
				const email = `${invitedId}@example.test`;
				// `invoice` mode for an unknown email creates the purchase invite.
				const purchaseInvite = await enrollCustomer(principal, {
					plan: priced.id,
					customer: email,
				});
				assert.equal(purchaseInvite.status, "invited");
				if (!("inviteUrl" in purchaseInvite)) throw new Error("unreachable");
				const token = new URL(purchaseInvite.inviteUrl).pathname
					.split("/")
					.pop();
				assert.ok(token);
				// The creator re-prices: the old version is superseded, so the
				// invite may not silently apply the new credits.
				await db
					.update(planVersions)
					.set({ status: "superseded", unpublishedAt: new Date() })
					.where(
						and(
							eq(planVersions.planId, priced.id),
							eq(planVersions.status, "published"),
						),
					);
				await db.insert(planVersions).values({
					planId: priced.id,
					creatorId,
					status: "published",
					billingMode: "one_time",
					currency: "usd",
					price: 2000,
					credits: 20,
					version: 2,
				});
				await db.insert(user).values({ id: invitedId, name: "Buyer", email });
				try {
					await assert.rejects(claimEnrollmentInvite(invitedId, email, token), {
						code: "INVITE_OUTDATED",
					});
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
