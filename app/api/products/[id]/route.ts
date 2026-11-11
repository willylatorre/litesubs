import { PATCH as patch } from "@/app/api/v1/[...resource]/route";
export async function PATCH(
	request: Request,
	context: { params: Promise<{ id: string }> },
) {
	const { id } = await context.params;
	return patch(request, {
		params: Promise.resolve({ resource: ["plans", id] }),
	});
}
