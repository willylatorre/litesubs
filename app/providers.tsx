"use client";

import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { authClient } from "@/lib/auth-client";

export function Providers({ children }: { children: ReactNode }) {
	const router = useRouter();
	const [queryClient] = useState(() => new QueryClient());

	return (
		<QueryClientProvider client={queryClient}>
			<AuthUIProvider
				authClient={authClient}
				navigate={router.push}
				social={{ providers: ["google"] }}
				replace={router.replace}
				onSessionChange={() => {
					// Clear router cache (protected routes)
					router.refresh();
				}}
				Link={Link}
			>
				{children}
			</AuthUIProvider>
		</QueryClientProvider>
	);
}
