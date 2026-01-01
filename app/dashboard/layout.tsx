import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@/lib/auth";
import { DashboardShell } from "./dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
	children,
}: {
	children: ReactNode;
}) {
	const session = await auth.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect(`/auth/sign-in?callbackURL=${encodeURIComponent("/dashboard")}`);
	}

	return <DashboardShell>{children}</DashboardShell>;
}
