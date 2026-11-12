"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AuthProvider } from "@/components/auth/auth-provider";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin";
import { dashboardBasePaths } from "@/lib/auth/base-paths";
import { twoFactorPlugin } from "@/lib/auth/two-factor-plugin";
import { authClient } from "@/lib/auth-client";
import { getQueryClient } from "@/lib/query-client";

export function DashboardShell({ children }: { children: ReactNode }) {
	const router = useRouter();
	const queryClient = getQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<AuthProvider
				authClient={authClient}
				basePaths={dashboardBasePaths}
				Link={Link}
				navigate={({ to, replace }) =>
					replace ? router.replace(to) : router.push(to)
				}
				plugins={[apiKeyPlugin(), twoFactorPlugin()]}
				queryClient={queryClient}
				redirectTo="/dashboard"
				socialProviders={["google"]}
			>
				<SidebarProvider
					style={
						{
							"--sidebar-width": "calc(var(--spacing) * 72)",
							"--header-height": "calc(var(--spacing) * 12)",
						} as React.CSSProperties
					}
				>
					<AppSidebar variant="inset" />
					<SidebarInset>
						<SiteHeader />
						<div className="flex flex-1 flex-col">{children}</div>
					</SidebarInset>
				</SidebarProvider>
			</AuthProvider>
		</QueryClientProvider>
	);
}
