import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function proxy(request: NextRequest) {
    // const session = await auth.api.getSession({
    //     headers: await headers()
    // })
    // Faster, less secure way to get session cookie
    const sessionCookie = getSessionCookie(request);

    // This is the recommended approach to optimistically redirect users
    // We recommend handling auth checks in each page/route
    if (!sessionCookie) {
        return NextResponse.redirect(new URL("/auth/sign-in", request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/dashboard/:path*"], // Specify the routes the middleware applies to
};