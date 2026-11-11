import { auth } from "@/lib/auth";

// Better Auth's plugin handles RFC 8414 issuer-inserted paths and RFC 9728
// resource-inserted paths. Next must actually route these public URLs to it.
export const runtime = "nodejs";
export function GET(request: Request) {
	return auth.handler(request);
}
export function HEAD(request: Request) {
	return auth.handler(request);
}
