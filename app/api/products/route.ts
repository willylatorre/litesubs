// Compatibility adapter; new clients use /api/v1/plans.
import { GET as get, POST as post } from "@/app/api/v1/[...resource]/route";

const context = { params: Promise.resolve({ resource: ["plans"] }) };
export function GET(request: Request) {
	return get(request, context);
}
export function POST(request: Request) {
	return post(request, context);
}
