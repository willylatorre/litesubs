"use client";

import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

export function DashboardShell({ children }: { children: ReactNode }) {
	const router = useRouter();
	const [queryClient] = useState(() => new QueryClient());

	return (
		<QueryClientProvider client={queryClient}>
			<AuthUIProvider
				authClient={authClient}
				navigate={router.push}
				social={{ providers: ["google"] }}
				replace={router.replace}
				redirectTo="/dashboard"
				onSessionChange={() => {
					// Clear router cache (protected routes)
					router.refresh();
				}}
				Link={Link}
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
			</AuthUIProvider>
		</QueryClientProvider>
	);
}

