import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import {
	webhookDeliveries,
	webhookDeliveryAttempts,
	webhookEndpoints,
} from "@/app/db/schema";
import {
	DELIVERY_TIMEOUT_MS,
	EVENT_ID_HEADER,
	EVENT_TYPE_HEADER,
	SIGNATURE_HEADER,
	TIMESTAMP_HEADER,
	WEBHOOK_EVENT_TYPES,
	type WebhookEvent,
	type WebhookEventType,
} from "@/lib/webhook-events";
import { type Principal, requireScope, ServiceError } from "./principal";

export {
	DELIVERY_TIMEOUT_MS,
	EVENT_ID_HEADER,
	EVENT_TYPE_HEADER,
	SIGNATURE_HEADER,
	TIMESTAMP_HEADER,
	WEBHOOK_EVENT_LABELS,
	WEBHOOK_EVENT_TYPES,
	type WebhookEvent,
	type WebhookEventType,
} from "@/lib/webhook-events";

/**
 * Outgoing webhooks: tell a creator's own systems that something happened.
 *
 * Design rules, and why:
 *
 * - Delivery happens inline at the ledger change, not from a scheduler. The
 *   repository deliberately has no cron for correctness, so an event is emitted
 *   when the write commits and every attempt is recorded. A failure is visible
 *   and re-sendable; it is never silently retried forever.
 * - The payload is stored verbatim and the `event_id` is fixed at emission, so a
 *   retry sends the same bytes with the same id. A receiver that dedupes on
 *   `X-Litesubs-Event-Id` can therefore treat a retry as the same event.
 * - The secret is used to sign, not to authenticate a caller, so it cannot be
 *   hashed. Reads never select it; only creation returns it, exactly once.
 * - Everything is tenant-scoped by `creator_id`, including delivery history and
 *   a manual retry, so one creator can neither see nor trigger another's.
 */

const SECRET_PREFIX = "whsec_";

export function newEventId(): string {
	return `evt_${randomBytes(16).toString("hex")}`;
}

export function newSigningSecret(): string {
	return `${SECRET_PREFIX}${randomBytes(24).toString("hex")}`;
}

/**
 * Sign the exact bytes we send.
 *
 * `v1` is the HMAC-SHA256 of `<timestamp>.<body>`, lowercase hex. Including the
 * timestamp lets a receiver reject a replayed body outside a tolerance window,
 * and signing the raw string means a reserialized body cannot verify. The
 * header carries one or more space-separated `v1=…` values so a future scheme
 * can be added without breaking existing receivers.
 */
export function signPayload(input: {
	secret: string;
	timestamp: number;
	body: string;
}): string {
	return createHmac("sha256", input.secret)
		.update(`${input.timestamp}.${input.body}`)
		.digest("hex");
}

export function signatureHeader(input: {
	secret: string;
	timestamp: number;
	body: string;
}): string {
	return `t=${input.timestamp},v1=${signPayload(input)}`;
}

/** Constant-time check used by tests and any future inbound verifier. */
export function verifySignature(input: {
	secret: string;
	timestamp: number;
	body: string;
	signature: string;
}): boolean {
	const provided = Buffer.from(input.signature);
	const expected = Buffer.from(signPayload(input));
	return (
		provided.length === expected.length && timingSafeEqual(provided, expected)
	);
}

/**
 * A delivery URL must be HTTPS, except on loopback.
 *
 * A signed payload sent over plaintext to a public host is readable by anyone on
 * the path, so `http://` is refused. Loopback is the one exception: it is how a
 * creator tests their receiver locally, and it cannot leave the machine.
 */
function isDeliverableUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (!url.username && !url.password && url.protocol === "https:")
			return true;
		if (url.protocol !== "http:") return false;
		return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
	} catch {
		return false;
	}
}

const deliveryUrl = z.string().trim().max(2000).refine(isDeliverableUrl, {
	message: "Webhook URLs must use https:// (loopback may use http://)",
});

const endpointInput = z.object({
	name: z.string().trim().min(1).max(120),
	url: deliveryUrl,
	events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(2),
});
export type EndpointInput = z.infer<typeof endpointInput>;

const updateInput = z.object({
	name: z.string().trim().min(1).max(120).optional(),
	url: deliveryUrl.optional(),
	events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(2).optional(),
	active: z.boolean().optional(),
});

/**
 * Public endpoint shape. `signingSecret` is intentionally absent: an exported
 * read or server action can be serialized to a browser, so a secret must never
 * ride along implicitly. Creation returns it from its own field.
 */
export type EndpointView = {
	id: string;
	name: string;
	url: string;
	events: WebhookEventType[];
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
};

function toView(row: typeof webhookEndpoints.$inferSelect): EndpointView {
	return {
		id: row.id,
		name: row.name,
		url: row.url,
		events: row.events as WebhookEventType[],
		active: row.active,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function requireCreatorWrites(principal: Principal) {
	// Configuration is not a credit movement: it needs the webhook scope and
	// must be impossible from a machine key, which `requireScope` enforces for
	// every scope except `credits:consume`.
	requireScope(principal, "webhooks:manage");
	if (principal.kind === "apiKey")
		throw new ServiceError(
			"FORBIDDEN",
			"Machine keys cannot configure webhooks",
			403,
		);
}

export async function listEndpoints(
	principal: Principal,
): Promise<EndpointView[]> {
	requireScope(principal, "webhooks:manage");
	if (principal.kind === "apiKey")
		throw new ServiceError(
			"FORBIDDEN",
			"Machine keys cannot read webhooks",
			403,
		);
	const rows = await db.query.webhookEndpoints.findMany({
		where: eq(webhookEndpoints.creatorId, principal.creatorId),
		orderBy: [desc(webhookEndpoints.createdAt)],
		// Explicit projection: the signing secret never leaves the server.
		columns: {
			id: true,
			name: true,
			url: true,
			events: true,
			active: true,
			createdAt: true,
			updatedAt: true,
		},
	});
	return rows.map((row) => ({
		...row,
		events: row.events as WebhookEventType[],
	}));
}

export async function createEndpoint(principal: Principal, input: unknown) {
	requireCreatorWrites(principal);
	const data = endpointInput.parse(input);
	const signingSecret = newSigningSecret();
	const [created] = await db
		.insert(webhookEndpoints)
		.values({
			creatorId: principal.creatorId,
			name: data.name,
			url: data.url,
			events: [...new Set(data.events)],
			signingSecret,
		})
		.onConflictDoNothing({
			target: [webhookEndpoints.creatorId, webhookEndpoints.url],
		})
		.returning();
	if (!created)
		throw new ServiceError(
			"ENDPOINT_EXISTS",
			"An endpoint already exists for this URL",
			409,
		);
	// The one and only time the secret is returned. Store it now.
	return { ...toView(created), signingSecret };
}

export async function updateEndpoint(
	principal: Principal,
	endpointId: string,
	input: unknown,
) {
	requireCreatorWrites(principal);
	const data = updateInput.parse(input);
	if (Object.keys(data).length === 0)
		throw new ServiceError("INVALID_INPUT", "No changes supplied");
	const [updated] = await db
		.update(webhookEndpoints)
		.set({
			...(data.name !== undefined ? { name: data.name } : {}),
			...(data.url !== undefined ? { url: data.url } : {}),
			...(data.events !== undefined
				? { events: [...new Set(data.events)] }
				: {}),
			...(data.active !== undefined ? { active: data.active } : {}),
		})
		.where(
			and(
				eq(webhookEndpoints.id, endpointId),
				eq(webhookEndpoints.creatorId, principal.creatorId),
			),
		)
		.returning();
	if (!updated) throw new ServiceError("NOT_FOUND", "Endpoint not found", 404);
	return toView(updated);
}

export async function deleteEndpoint(principal: Principal, endpointId: string) {
	requireCreatorWrites(principal);
	const [deleted] = await db
		.delete(webhookEndpoints)
		.where(
			and(
				eq(webhookEndpoints.id, endpointId),
				eq(webhookEndpoints.creatorId, principal.creatorId),
			),
		)
		.returning({ id: webhookEndpoints.id });
	if (!deleted) throw new ServiceError("NOT_FOUND", "Endpoint not found", 404);
	return { id: deleted.id };
}

export async function listDeliveries(
	principal: Principal,
	input: unknown = {},
) {
	requireScope(principal, "webhooks:manage");
	if (principal.kind === "apiKey")
		throw new ServiceError(
			"FORBIDDEN",
			"Machine keys cannot read deliveries",
			403,
		);
	const page = z
		.object({
			endpoint: z.string().optional(),
			status: z.enum(["pending", "succeeded", "failed"]).optional(),
			limit: z.coerce.number().int().min(1).max(100).default(50),
			offset: z.coerce.number().int().min(0).default(0),
		})
		.parse(input);
	const conditions = [eq(webhookDeliveries.creatorId, principal.creatorId)];
	if (page.endpoint)
		conditions.push(eq(webhookDeliveries.endpointId, page.endpoint));
	if (page.status) conditions.push(eq(webhookDeliveries.status, page.status));
	const rows = await db.query.webhookDeliveries.findMany({
		where: and(...conditions),
		orderBy: [desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id)],
		limit: page.limit,
		offset: page.offset,
		columns: {
			id: true,
			endpointId: true,
			eventId: true,
			eventType: true,
			status: true,
			attempts: true,
			responseStatus: true,
			lastError: true,
			lastAttemptedAt: true,
			deliveredAt: true,
			createdAt: true,
		},
		with: {
			endpoint: { columns: { id: true, name: true, url: true, active: true } },
		},
	});
	return rows;
}

/**
 * One attempt, recorded as it happens.
 *
 * `outcome` is derived from the response, not trusted from the caller. Any
 * non-2xx, timeout, DNS failure, or transport error is a failure with a redacted
 * reason; the receiver's body is never stored, because it may echo anything.
 */
async function attemptDelivery(delivery: {
	id: string;
	creatorId: string;
	payload: string;
	attempts: number;
	eventId: string;
	eventType: string;
	endpointId: string;
	url: string;
	signingSecret: string;
}) {
	const timestamp = Math.floor(Date.now() / 1000);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"User-Agent": "Litesubs-Webhooks/1",
		[EVENT_ID_HEADER]: delivery.eventId,
		[EVENT_TYPE_HEADER]: delivery.eventType,
		[TIMESTAMP_HEADER]: String(timestamp),
		[SIGNATURE_HEADER]: signatureHeader({
			secret: delivery.signingSecret,
			timestamp,
			body: delivery.payload,
		}),
	};

	const startedAt = Date.now();
	let responseStatus: number | null = null;
	let error: string | null = null;

	try {
		const response = await fetch(delivery.url, {
			method: "POST",
			headers,
			body: delivery.payload,
			signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
			// A redirect could forward our signed payload to a host the creator did
			// not configure, so it is a failed attempt rather than followed.
			redirect: "manual",
			cache: "no-store",
		});
		responseStatus = response.status;
		if (response.status < 200 || response.status >= 300)
			error = `Receiver responded ${response.status}`;
		// The body is intentionally not read: it is untrusted and unnecessary.
	} catch (caught) {
		error =
			caught instanceof Error && caught.name === "TimeoutError"
				? `Timed out after ${DELIVERY_TIMEOUT_MS}ms`
				: "Could not reach the endpoint";
	}
	const durationMs = Date.now() - startedAt;
	const succeeded = error === null;
	const attemptNumber = delivery.attempts + 1;

	const [attempt] = await db
		.insert(webhookDeliveryAttempts)
		.values({
			deliveryId: delivery.id,
			creatorId: delivery.creatorId,
			attemptNumber,
			outcome: succeeded ? "succeeded" : "failed",
			responseStatus,
			error,
			durationMs,
		})
		.returning({ id: webhookDeliveryAttempts.id });

	await db
		.update(webhookDeliveries)
		.set({
			status: succeeded ? "succeeded" : "failed",
			attempts: attemptNumber,
			responseStatus,
			lastError: error,
			lastAttemptedAt: new Date(),
			deliveredAt: succeeded ? new Date() : null,
		})
		.where(eq(webhookDeliveries.id, delivery.id));

	return { attemptId: attempt.id, succeeded, responseStatus, error };
}

/**
 * Emit one event to every active endpoint subscribed to it.
 *
 * Failures never throw: a webhook is a notification, and losing one must not
 * roll back a purchase or a credit change the customer already received. Each
 * failure is recorded and retryable from the dashboard.
 *
 * `eventId` is supplied by the caller so the same ledger write can be retried
 * idempotently. When it is omitted a fresh id is minted.
 */
export async function emitWebhookEvent(input: {
	creatorId: string;
	type: WebhookEventType;
	data: WebhookEvent["data"];
	eventId?: string;
}): Promise<{ eventId: string; delivered: number; failed: number }> {
	const eventId = input.eventId ?? newEventId();
	const event: WebhookEvent = {
		id: eventId,
		type: input.type,
		createdAt: new Date().toISOString(),
		data: input.data,
	};
	if (input.eventId) {
		// A retry must resend the original bytes, which only exist if the event was
		// already recorded. Look before rewriting the timestamp.
		const existing = await db.query.webhookDeliveries.findFirst({
			where: and(
				eq(webhookDeliveries.creatorId, input.creatorId),
				eq(webhookDeliveries.eventId, input.eventId),
			),
			columns: { payload: true },
		});
		if (existing) event.createdAt = JSON.parse(existing.payload).createdAt;
	}
	const payload = JSON.stringify(event);

	const endpoints = await db.query.webhookEndpoints.findMany({
		where: and(
			eq(webhookEndpoints.creatorId, input.creatorId),
			eq(webhookEndpoints.active, true),
		),
		columns: {
			id: true,
			url: true,
			events: true,
			signingSecret: true,
		},
	});
	const subscribed = endpoints.filter((endpoint) =>
		(endpoint.events as string[]).includes(input.type),
	);
	if (subscribed.length === 0) return { eventId, delivered: 0, failed: 0 };

	let delivered = 0;
	let failed = 0;
	for (const endpoint of subscribed) {
		const [created] = await db
			.insert(webhookDeliveries)
			.values({
				endpointId: endpoint.id,
				creatorId: input.creatorId,
				eventId,
				eventType: input.type,
				payload,
			})
			// A duplicate emission (for example a replayed Stripe event) resolves to
			// the delivery already recorded, and is not sent twice.
			.onConflictDoNothing({
				target: [webhookDeliveries.endpointId, webhookDeliveries.eventId],
			})
			.returning();
		if (!created) {
			// This event was already recorded for this endpoint. It is neither a new
			// delivery nor a failure, so it is not counted either way.
			continue;
		}
		const result = await attemptDelivery({
			id: created.id,
			creatorId: input.creatorId,
			payload,
			attempts: created.attempts,
			eventId,
			eventType: input.type,
			endpointId: endpoint.id,
			url: endpoint.url,
			signingSecret: endpoint.signingSecret,
		});
		if (result.succeeded) delivered += 1;
		else failed += 1;
	}
	return { eventId, delivered, failed };
}

/**
 * Re-send one recorded delivery.
 *
 * The stored payload and event id are reused verbatim, so a receiver dedupes it
 * as the same event rather than as a new purchase. Only the owning creator may
 * retry, and only while the endpoint still exists.
 */
export async function retryDelivery(principal: Principal, deliveryId: string) {
	requireCreatorWrites(principal);
	const delivery = await db.query.webhookDeliveries.findFirst({
		where: and(
			eq(webhookDeliveries.id, deliveryId),
			eq(webhookDeliveries.creatorId, principal.creatorId),
		),
		with: {
			endpoint: {
				columns: {
					id: true,
					url: true,
					active: true,
					signingSecret: true,
				},
			},
		},
	});
	if (!delivery) throw new ServiceError("NOT_FOUND", "Delivery not found", 404);
	if (delivery.status === "succeeded")
		throw new ServiceError(
			"ALREADY_DELIVERED",
			"This delivery already succeeded",
			409,
		);

	const result = await attemptDelivery({
		id: delivery.id,
		creatorId: delivery.creatorId,
		payload: delivery.payload,
		attempts: delivery.attempts,
		eventId: delivery.eventId,
		eventType: delivery.eventType,
		endpointId: delivery.endpointId,
		url: delivery.endpoint.url,
		signingSecret: delivery.endpoint.signingSecret,
	});
	return { ...result, eventId: delivery.eventId };
}

/** The attempt history for one delivery, newest first, scoped to its creator. */
export async function getDeliveryAttempts(
	principal: Principal,
	deliveryId: string,
) {
	requireScope(principal, "webhooks:manage");
	if (principal.kind === "apiKey")
		throw new ServiceError(
			"FORBIDDEN",
			"Machine keys cannot read deliveries",
			403,
		);
	const delivery = await db.query.webhookDeliveries.findFirst({
		where: and(
			eq(webhookDeliveries.id, deliveryId),
			eq(webhookDeliveries.creatorId, principal.creatorId),
		),
		columns: { id: true },
	});
	if (!delivery) throw new ServiceError("NOT_FOUND", "Delivery not found", 404);
	return db.query.webhookDeliveryAttempts.findMany({
		where: eq(webhookDeliveryAttempts.deliveryId, deliveryId),
		orderBy: [desc(webhookDeliveryAttempts.attemptNumber)],
	});
}

/**
 * Fire one test event at an endpoint, using the real signing and delivery path.
 *
 * A test is recorded like any other delivery, so "it worked" is observable in
 * the same history as production traffic instead of being a one-off toast.
 */
export async function sendTestEvent(principal: Principal, endpointId: string) {
	requireCreatorWrites(principal);
	const endpoint = await db.query.webhookEndpoints.findFirst({
		where: and(
			eq(webhookEndpoints.id, endpointId),
			eq(webhookEndpoints.creatorId, principal.creatorId),
		),
	});
	if (!endpoint) throw new ServiceError("NOT_FOUND", "Endpoint not found", 404);
	return emitWebhookEvent({
		creatorId: principal.creatorId,
		type: "credits.changed",
		data: {
			creatorId: principal.creatorId,
			customerId: "test_customer",
			planId: "test_plan",
			transactionId: null,
			amount: 0,
			balance: 0,
			amountMoney: null,
			currency: null,
		},
		eventId: `evt_test_${randomBytes(12).toString("hex")}`,
	});
}
