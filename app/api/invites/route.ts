// Compatibility adapter; new clients use /api/v1/invites.
import { GET as get, POST as post } from "@/app/api/v1/[...resource]/route";

const context = { params: Promise.resolve({ resource: ["invites"] }) };
export function GET(request: Request) {
	return get(request, context);
}
export function POST(request: Request) {
	return post(request, context);
}
