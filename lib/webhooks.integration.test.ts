/**
 * Outgoing webhooks are the one place liteSubs sends customer and balance data
 * outside the app. These tests target what would actually leak or mislead:
 * a forged/unverifiable signature, a secret readable after creation, an event
 * that never reaches the receiver, a retry that looks like a second purchase,
 * and one creator's endpoint being reachable by another.
 *
 * Real service, real database, and a real HTTP receiver on loopback — the same
 * `fetch` code path production uses.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	enrollments,
	payments,
	plans,
	planVersions,
	transactions,
	user,
	webhookDeliveries,
	webhookDeliveryAttempts,
	webhookEndpoints,
} from "@/app/db/schema";
import { adjustCredits } from "@/lib/services/credits";
import {
	type Principal,
	ServiceError,
	sessionPrincipal,
} from "@/lib/services/principal";
import { fulfillPayment } from "@/lib/services/purchase";
import {
	createEndpoint,
	deleteEndpoint,
	emitWebhookEvent,
	getDeliveryAttempts,
	listDeliveries,
	listEndpoints,
	retryDelivery,
	signPayload,
	updateEndpoint,
	verifySignature,
} from "@/lib/services/webhooks";
import { grantTestPremium } from "@/lib/test-premium";

type Received = {
	body: string;
	headers: Record<string, string | string[] | undefined>;
};

/**
 * A receiver that records exactly what it was sent, and answers with whichever
 * status the test needs. One server per test keeps assertions unambiguous.
 */
async function receiver(
	status: () => number = () => 200,
): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
	const received: Received[] = [];
	const server: Server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			received.push({
				body: Buffer.concat(chunks).toString("utf8"),
				headers: request.headers,
			});
			response.writeHead(status(), { "Content-Type": "application/json" });
			response.end("{}");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}/hook`,
		received,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}

function header(received: Received, name: string): string {
	const value = received.headers[name];
	return typeof value === "string" ? value : "";
}

/** Parse `t=<unix>,v1=<hex>` from the signature header. */
function parseSignature(signature: string) {
	const parts = Object.fromEntries(
		signature.split(",").map((part) => part.split("=") as [string, string]),
	);
	return { timestamp: Number(parts.t), v1: parts.v1 ?? "" };
}

test("outgoing webhooks sign, deliver, and stay tenant-scoped", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);

	const creatorId = crypto.randomUUID();
	const otherCreatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);
	const otherCreator = sessionPrincipal(otherCreatorId);
	const machine: Principal = {
		kind: "apiKey",
		creatorId,
		scopes: ["credits:consume"],
	};

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{
			id: otherCreatorId,
			name: "Other creator",
			email: `${otherCreatorId}@example.test`,
		},
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
	]);
	// Outgoing webhooks are Premium-only; this fixture says so explicitly.
	await grantTestPremium(creatorId);
	await grantTestPremium(otherCreatorId);
	const [plan] = await db
		.insert(plans)
		.values({ creatorId, name: "Lessons" })
		.returning();
	await db.insert(planVersions).values({
		planId: plan.id,
		creatorId,
		status: "published",
		billingMode: "one_time",
		currency: "usd",
		price: 1000,
		credits: 10,
		version: 1,
		publishedAt: new Date(),
	});
	// An enrollment must exist before a credit change can target the plan.
	await db
		.insert(enrollments)
		.values({ userId: buyerId, planId: plan.id, creatorId, credits: 0 });

	const makeReceived = await receiver();

	try {
		await t.test(
			"creation returns the secret once and reads never expose it",
			async () => {
				const created = await createEndpoint(creator, {
					name: "Backend",
					url: makeReceived.url,
					events: ["credits.changed"],
				});
				assert.ok(created.signingSecret.startsWith("whsec_"));

				const listed = await listEndpoints(creator);
				assert.equal(listed.length, 1);
				// The read shape has no secret field at all, not a nulled one.
				assert.ok(
					!("signingSecret" in listed[0]),
					"listEndpoints must not serialize the signing secret",
				);

				// The database does hold it — it is needed to sign — but no read
				// path selects it, which is the contract that matters.
				const stored = await db.query.webhookEndpoints.findFirst({
					where: and(
						eq(webhookEndpoints.creatorId, creatorId),
						eq(webhookEndpoints.url, makeReceived.url),
					),
					columns: { signingSecret: true },
				});
				assert.equal(stored?.signingSecret, created.signingSecret);
			},
		);

		await t.test(
			"a credit change is delivered with a verifiable signature",
			async () => {
				const endpoint = await db.query.webhookEndpoints.findFirst({
					where: eq(webhookEndpoints.creatorId, creatorId),
				});
				assert.ok(endpoint);

				const change = await adjustCredits(creator, {
					customerId: buyerId,
					planId: plan.id,
					delta: 5,
					type: "manual_adjustment",
					reason: "Goodwill bonus",
				});
				assert.ok(change.transactionId);
				assert.equal(change.after, 5);

				assert.equal(makeReceived.received.length, 1);
				const delivered = makeReceived.received[0];

				// The signature covers the exact bytes and a timestamp, so a
				// reserialized body or an old replay cannot verify.
				const { timestamp, v1 } = parseSignature(
					header(delivered, "x-litesubs-signature"),
				);
				assert.ok(timestamp > 0);
				assert.deepEqual(Object.keys(JSON.parse(delivered.body)).sort(), [
					"createdAt",
					"data",
					"id",
					"type",
				]);
				assert.ok(
					verifySignature({
						secret: endpoint.signingSecret,
						timestamp,
						body: delivered.body,
						signature: v1,
					}),
					"the delivered signature must verify with the endpoint secret",
				);
				assert.notEqual(
					v1,
					signPayload({
						secret: endpoint.signingSecret,
						timestamp,
						body: `${delivered.body} `,
					}),
					"a modified body must not share the signature",
				);

				// The receiver gets the dedupe id and the business facts, and no PII.
				assert.match(header(delivered, "x-litesubs-event-id"), /^evt_/);
				assert.equal(
					header(delivered, "x-litesubs-event-type"),
					"credits.changed",
				);
				const event = JSON.parse(delivered.body);
				assert.equal(event.type, "credits.changed");
				assert.equal(event.data.customerId, buyerId);
				assert.equal(event.data.planId, plan.id);
				assert.equal(event.data.amount, 5);
				assert.equal(event.data.balance, 5);
				assert.equal(event.data.transactionId, change.transactionId);
				assert.equal(event.data.creatorId, creatorId);
				assert.doesNotMatch(
					delivered.body,
					/example\.test|acct_|cus_|cs_|whsec_|stripe/i,
					"no email, Stripe id, or secret may appear in a payload",
				);

				// A successful attempt is recorded, not just inferred.
				const delivery = await db.query.webhookDeliveries.findFirst({
					where: eq(webhookDeliveries.creatorId, creatorId),
					orderBy: [webhookDeliveries.createdAt],
					with: { attemptHistory: true },
				});
				assert.equal(delivery?.status, "succeeded");
				assert.equal(delivery?.attempts, 1);
				assert.equal(delivery?.responseStatus, 200);
				assert.equal(delivery?.lastError, null);
				assert.equal(delivery?.attemptHistory.length, 1);
				assert.equal(delivery?.attemptHistory[0].outcome, "succeeded");
			},
		);

		await t.test(
			"a failing receiver records the failure and is retryable",
			async () => {
				let status = 500;
				const failing = await receiver(() => status);
				const created = await createEndpoint(creator, {
					name: "Flaky",
					url: failing.url,
					events: ["credits.changed"],
				});

				try {
					await adjustCredits(creator, {
						customerId: buyerId,
						planId: plan.id,
						delta: 2,
						type: "manual_adjustment",
						reason: "Another bonus",
					});

					const failed = await db.query.webhookDeliveries.findFirst({
						where: and(
							eq(webhookDeliveries.creatorId, creatorId),
							eq(webhookDeliveries.endpointId, created.id),
						),
						with: { attemptHistory: true },
					});
					assert.equal(failed?.status, "failed");
					assert.equal(failed?.attempts, 1);
					assert.equal(failed?.responseStatus, 500);
					assert.match(failed?.lastError ?? "", /500/);
					assert.equal(failed?.deliveredAt, null);
					assert.equal(failed?.attemptHistory[0].outcome, "failed");
					assert.equal(failing.received.length, 1);

					// The original event id is reused, so the receiver can dedupe.
					status = 200;
					const retried = await retryDelivery(creator, failed.id);
					assert.equal(retried.succeeded, true);
					assert.equal(retried.eventId, failed.eventId);
					assert.equal(failing.received.length, 2);
					assert.equal(
						JSON.parse(failing.received[1].body).id,
						failed.eventId,
						"a retry must resend the same event id",
					);
					assert.equal(
						failing.received[1].body,
						failing.received[0].body,
						"a retry must resend the identical stored payload",
					);

					const after = await db.query.webhookDeliveries.findFirst({
						where: eq(webhookDeliveries.id, failed.id),
					});
					assert.equal(after?.status, "succeeded");
					assert.equal(after?.attempts, 2);
					// Both attempts remain in history rather than being overwritten.
					const attempts = await getDeliveryAttempts(creator, failed.id);
					assert.equal(attempts.length, 2);
					assert.deepEqual(attempts.map((attempt) => attempt.outcome).sort(), [
						"failed",
						"succeeded",
					]);

					// A succeeded delivery is not re-sent; a duplicate retry would look
					// like a second event to a receiver that trusts the header.
					await assert.rejects(
						() => retryDelivery(creator, failed.id),
						(error: unknown) =>
							error instanceof ServiceError &&
							error.code === "ALREADY_DELIVERED",
					);
				} finally {
					await deleteEndpoint(creator, created.id);
					await failing.close();
				}
			},
		);

		await t.test(
			"a fulfilled pack purchase emits purchase.completed",
			async () => {
				// A subscription for this endpoint only listens to credits.changed,
				// so a purchase needs its own subscriber to prove the other event.
				const purchases = await receiver();
				const created = await createEndpoint(creator, {
					name: "Purchase listener",
					url: purchases.url,
					events: ["purchase.completed"],
				});
				const [payment] = await db
					.insert(payments)
					.values({
						creatorId,
						userId: buyerId,
						planId: plan.id,
						planVersionId: (
							await db.query.planVersions.findFirst({
								where: eq(planVersions.planId, plan.id),
								columns: { id: true },
							})
						)?.id as string,
						stripeAccountId: "acct_seller",
						stripeCheckoutId: `cs_${crypto.randomUUID()}`,
						status: "pending",
						credits: 10,
						amountTotal: 1000,
						currency: "usd",
						applicationFee: 20,
					})
					.returning();
				try {
					const result = await fulfillPayment({
						checkoutSessionId: payment.stripeCheckoutId as string,
						amountPaid: 1000,
					});
					assert.equal(result.status, "fulfilled");
					assert.equal(purchases.received.length, 1);

					const event = JSON.parse(purchases.received[0].body);
					assert.equal(event.type, "purchase.completed");
					assert.equal(event.data.customerId, buyerId);
					assert.equal(event.data.planId, plan.id);
					assert.equal(event.data.amount, 10);
					assert.equal(event.data.amountMoney, 1000);
					assert.equal(event.data.currency, "usd");
					assert.ok(event.data.transactionId, "the ledger row is referenced");
					assert.equal(
						header(purchases.received[0], "x-litesubs-event-type"),
						"purchase.completed",
					);

					// Fulfilling again is a no-op and must not re-notify.
					const replay = await fulfillPayment({
						checkoutSessionId: payment.stripeCheckoutId as string,
						amountPaid: 1000,
					});
					assert.equal(replay.status, "already_fulfilled");
					assert.equal(purchases.received.length, 1);
				} finally {
					await deleteEndpoint(creator, created.id);
					await purchases.close();
				}
			},
		);

		await t.test(
			"replaying the same ledger event does not create a second delivery",
			async () => {
				const endpoint = await db.query.webhookEndpoints.findFirst({
					where: eq(webhookEndpoints.creatorId, creatorId),
				});
				assert.ok(endpoint);
				const [entry] = await db
					.insert(transactions)
					.values({
						userId: buyerId,
						creatorId,
						planId: plan.id,
						amount: 6,
						type: "manual_adjustment",
						status: "completed",
						description: "Replay probe",
					})
					.returning();

				const input = {
					creatorId,
					type: "credits.changed" as const,
					eventId: `evt_credits_${entry.id}`,
					data: {
						creatorId,
						customerId: buyerId,
						planId: plan.id,
						transactionId: entry.id,
						amount: 6,
						balance: 6,
						amountMoney: null,
						currency: null,
					},
				};
				const first = await emitWebhookEvent(input);
				const before = makeReceived.received.length;
				const second = await emitWebhookEvent(input);
				assert.equal(first.eventId, second.eventId);

				// Exactly one delivery row exists for this (endpoint, event) pair, and
				// the receiver saw the event only once.
				const deliveries = await db.query.webhookDeliveries.findMany({
					where: and(
						eq(webhookDeliveries.creatorId, creatorId),
						eq(webhookDeliveries.eventId, first.eventId),
					),
				});
				assert.equal(deliveries.length, 1);
				assert.equal(makeReceived.received.length, before);
				const attempts = await db
					.select()
					.from(webhookDeliveryAttempts)
					.where(eq(webhookDeliveryAttempts.deliveryId, deliveries[0].id));
				assert.equal(attempts.length, 1, "a replay must not attempt again");
			},
		);

		await t.test(
			"creator B can neither see nor trigger creator A's endpoint",
			async () => {
				const [endpoint] = await db
					.select()
					.from(webhookEndpoints)
					.where(eq(webhookEndpoints.creatorId, creatorId))
					.limit(1);
				assert.ok(endpoint);
				const [delivery] = await db
					.select()
					.from(webhookDeliveries)
					.where(eq(webhookDeliveries.creatorId, creatorId))
					.limit(1);
				assert.ok(delivery);

				// Reads are empty for the other creator, not merely filtered later.
				assert.deepEqual(await listEndpoints(otherCreator), []);
				assert.deepEqual(await listDeliveries(otherCreator), []);

				// Configuration, retry, and deletion all 404 rather than act.
				for (const attempt of [
					() => updateEndpoint(otherCreator, endpoint.id, { active: false }),
					() => deleteEndpoint(otherCreator, endpoint.id),
					() => retryDelivery(otherCreator, delivery.id),
					() => getDeliveryAttempts(otherCreator, delivery.id),
				])
					await assert.rejects(
						attempt,
						(error: unknown) =>
							error instanceof ServiceError && error.code === "NOT_FOUND",
					);

				// The failed attempt left A's endpoint and delivery intact.
				const untouched = await db.query.webhookEndpoints.findFirst({
					where: eq(webhookEndpoints.id, endpoint.id),
				});
				assert.equal(untouched?.active, endpoint.active);

				// Emitting for B never reaches A's receiver.
				const before = makeReceived.received.length;
				await emitWebhookEvent({
					creatorId: otherCreatorId,
					type: "credits.changed",
					data: {
						creatorId: otherCreatorId,
						customerId: buyerId,
						planId: plan.id,
						transactionId: null,
						amount: 1,
						balance: 1,
						amountMoney: null,
						currency: null,
					},
				});
				assert.equal(makeReceived.received.length, before);
			},
		);

		await t.test("a machine key cannot configure webhooks", async () => {
			for (const attempt of [
				() =>
					createEndpoint(machine, {
						name: "Key",
						url: "https://example.test/hook",
						events: ["credits.changed"],
					}),
				() => listEndpoints(machine),
				() => listDeliveries(machine),
			])
				await assert.rejects(
					attempt,
					(error: unknown) =>
						error instanceof ServiceError && error.code === "FORBIDDEN",
				);
		});
	} finally {
		await makeReceived.close();
		// Deleting the creator cascades endpoints, deliveries, and attempts.
		for (const id of [creatorId, otherCreatorId, buyerId])
			await db.delete(user).where(eq(user.id, id));
		await db.$client.end();
	}
});
