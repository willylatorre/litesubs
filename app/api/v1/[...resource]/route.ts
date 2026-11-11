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

export const runtime = "nodejs";
async function handle(
	request: Request,
	context: { params: Promise<{ resource: string[] }> },
) {
	try {
		const { resource } = await context.params;
		return await withPrincipal(request, async (req, principal) => {
			const [group, id] = resource;
			const query = Object.fromEntries(new URL(req.url).searchParams);
			let result: unknown;
			let status = 200;
			if (resource.length > 2)
				return Response.json({ error: "Not found" }, { status: 404 });
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

export { handle as GET, handle as POST, handle as PATCH };
