"use server";

import { revalidatePath } from "next/cache";
import { authenticatedAction } from "@/lib/safe-action";
import { ServiceError, sessionPrincipal } from "@/lib/services/principal";
import {
	createEndpoint,
	deleteEndpoint,
	getDeliveryAttempts,
	listDeliveries,
	listEndpoints,
	retryDelivery,
	sendTestEvent,
	updateEndpoint,
} from "@/lib/services/webhooks";

/**
 * Thin creator-facing wrappers over the webhook service. The service owns
 * scopes and tenant isolation; these only bind the session and revalidate.
 *
 * A session principal holds `webhooks:manage`, so dashboard use needs no extra
 * grant. The same services reject machine API keys, which is what keeps a
 * consumption key from re-pointing a creator's event stream.
 */

function failure(error: unknown, fallback: string) {
	return {
		success: false as const,
		error: error instanceof ServiceError ? error.message : fallback,
		code: error instanceof ServiceError ? error.code : undefined,
	};
}

export async function getWebhookEndpoints() {
	return authenticatedAction(async (session) => {
		try {
			return {
				success: true as const,
				data: await listEndpoints(sessionPrincipal(session.user.id)),
			};
		} catch (error) {
			return failure(error, "Could not load webhook endpoints");
		}
	});
}

/** The returned `signingSecret` is the only copy; show it once and store it. */
export async function createWebhookEndpoint(input: {
	name: string;
	url: string;
	events: ("purchase.completed" | "credits.changed")[];
}) {
	return authenticatedAction(async (session) => {
		try {
			const created = await createEndpoint(
				sessionPrincipal(session.user.id),
				input,
			);
			revalidatePath("/dashboard/developers/webhooks");
			return { success: true as const, data: created };
		} catch (error) {
			return failure(error, "Could not create the endpoint");
		}
	});
}

export async function updateWebhookEndpoint(input: {
	id: string;
	name?: string;
	url?: string;
	events?: ("purchase.completed" | "credits.changed")[];
	active?: boolean;
}) {
	return authenticatedAction(async (session) => {
		try {
			const { id, ...changes } = input;
			const updated = await updateEndpoint(
				sessionPrincipal(session.user.id),
				id,
				changes,
			);
			revalidatePath("/dashboard/developers/webhooks");
			return { success: true as const, data: updated };
		} catch (error) {
			return failure(error, "Could not update the endpoint");
		}
	});
}

export async function deleteWebhookEndpoint(endpointId: string) {
	return authenticatedAction(async (session) => {
		try {
			await deleteEndpoint(sessionPrincipal(session.user.id), endpointId);
			revalidatePath("/dashboard/developers/webhooks");
			return { success: true as const };
		} catch (error) {
			return failure(error, "Could not delete the endpoint");
		}
	});
}

export async function getWebhookDeliveries(
	options: {
		endpoint?: string;
		status?: "pending" | "succeeded" | "failed";
		limit?: number;
	} = {},
) {
	return authenticatedAction(async (session) => {
		try {
			return {
				success: true as const,
				data: await listDeliveries(sessionPrincipal(session.user.id), options),
			};
		} catch (error) {
			return failure(error, "Could not load deliveries");
		}
	});
}

export async function getWebhookDeliveryAttempts(deliveryId: string) {
	return authenticatedAction(async (session) => {
		try {
			return {
				success: true as const,
				data: await getDeliveryAttempts(
					sessionPrincipal(session.user.id),
					deliveryId,
				),
			};
		} catch (error) {
			return failure(error, "Could not load attempts");
		}
	});
}

/** Re-send one failed delivery with its original event id and payload. */
export async function retryWebhookDelivery(deliveryId: string) {
	return authenticatedAction(async (session) => {
		try {
			const result = await retryDelivery(
				sessionPrincipal(session.user.id),
				deliveryId,
			);
			revalidatePath("/dashboard/developers/webhooks");
			return { success: true as const, data: result };
		} catch (error) {
			return failure(error, "Could not re-send the delivery");
		}
	});
}

export async function sendWebhookTestEvent(endpointId: string) {
	return authenticatedAction(async (session) => {
		try {
			const result = await sendTestEvent(
				sessionPrincipal(session.user.id),
				endpointId,
			);
			revalidatePath("/dashboard/developers/webhooks");
			return { success: true as const, data: result };
		} catch (error) {
			return failure(error, "Could not send the test event");
		}
	});
}
