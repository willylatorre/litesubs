import { errorResponse } from "@/lib/api-response";
import { withPrincipal } from "@/lib/principal";
import { changeCredits } from "@/lib/services/credits";
import {
	getCustomer,
	listCustomers,
	listTransactions,
} from "@/lib/services/customers";
import {
	createInvite,
	enrollCustomer,
	listInvites,
} from "@/lib/services/enroll";
import {
	createPlan,
	getPlan,
	listPlans,
	updatePlan,
} from "@/lib/services/plans";
import type { Principal } from "@/lib/services/principal";
import { publishPlan, unpublishPlan } from "@/lib/services/publish";
import {
	createEndpoint,
	deleteEndpoint,
	listDeliveries,
	listEndpoints,
	retryDelivery,
	sendTestEvent,
	updateEndpoint,
} from "@/lib/services/webhooks";

export const runtime = "nodejs";

/**
 * Resolve a POST transition on an existing record. Returns `null` when the path
 * is not a known transition, which the caller turns into a 404.
 */
async function transition(
	principal: Principal,
	group: string,
	id: string,
	action: string | undefined,
) {
	if (group === "plans") {
		if (action === "publish") return publishPlan(principal, { plan: id });
		if (action === "unpublish")
			return unpublishPlan(principal, { plan: id, confirm: true });
		return null;
	}
	if (group === "deliveries" && action === "retry")
		return retryDelivery(principal, id);
	if (group === "webhooks" && action === "test")
		return sendTestEvent(principal, id);
	return null;
}

async function handle(
	request: Request,
	context: { params: Promise<{ resource: string[] }> },
) {
	try {
		const { resource } = await context.params;
		return await withPrincipal(request, async (req, principal) => {
			const [group, id, action] = resource;
			const query = Object.fromEntries(new URL(req.url).searchParams);
			// A third path segment is a transition on an existing record, never a
			// separately addressable one: plan publish/unpublish, and webhook
			// delivery retry / endpoint test.
			if (resource.length > 3)
				return Response.json({ error: "Not found" }, { status: 404 });
			if (resource.length === 3) {
				if (!id || req.method !== "POST")
					return Response.json({ error: "Not found" }, { status: 404 });
				const handled = await transition(principal, group, id, action);
				if (!handled)
					return Response.json({ error: "Not found" }, { status: 404 });
				return Response.json(handled, {
					status: 200,
					headers: { "Cache-Control": "no-store" },
				});
			}
			let result: unknown;
			let status = 200;
			switch (`${req.method} ${group}`) {
				case "GET plans":
					result = id
						? await getPlan(principal, id)
						: await listPlans(principal, query);
					break;
				case "POST plans":
					if (id) break;
					result = await createPlan(principal, await req.json());
					status = 201;
					break;
				case "PATCH plans":
					if (!id) break;
					result = await updatePlan(principal, id, await req.json());
					break;
				case "GET customers":
					result = id
						? await getCustomer(principal, id)
						: await listCustomers(principal, query);
					break;
				case "POST enrollments":
					if (id) break;
					result = await enrollCustomer(principal, await req.json());
					break;
				case "GET transactions":
					if (id) break;
					result = await listTransactions(principal, query);
					break;
				case "GET invites":
					if (id) break;
					result = await listInvites(principal, query);
					break;
				case "POST invites":
					if (id) break;
					result = await createInvite(principal, await req.json());
					break;
				case "POST credits":
					if (id !== "consume" && id !== "grant") break;
					result = await changeCredits(
						principal,
						await req.json(),
						id === "consume" ? "usage" : "manual_adjustment",
					);
					break;
				case "GET webhooks":
					result = id
						? (await listEndpoints(principal)).find(
								(endpoint) => endpoint.id === id,
							)
						: await listEndpoints(principal);
					break;
				case "POST webhooks":
					if (id) break;
					result = await createEndpoint(principal, await req.json());
					status = 201;
					break;
				case "PATCH webhooks":
					if (!id) break;
					result = await updateEndpoint(principal, id, await req.json());
					break;
				case "DELETE webhooks":
					if (!id) break;
					result = await deleteEndpoint(principal, id);
					break;
				case "GET deliveries":
					if (id) break;
					result = await listDeliveries(principal, query);
					break;
			}
			if (result === undefined)
				return Response.json({ error: "Not found" }, { status: 404 });
			return Response.json(result, {
				status,
				headers: { "Cache-Control": "no-store" },
			});
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST };
