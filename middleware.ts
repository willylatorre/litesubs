import type { NextRequest } from "next/server";
import { proxy } from "@/app/proxy";

export function middleware(request: NextRequest) {
	return proxy(request);
}

export const config = {
	matcher: ["/dashboard/:path*"],
};
