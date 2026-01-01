import type { NextRequest } from "next/server";
import { proxy as authProxy } from "@/app/proxy";

export function proxy(request: NextRequest) {
	return authProxy(request);
}

export const config = {
	matcher: ["/dashboard/:path*"],
};
