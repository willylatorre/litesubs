"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";

import { apiKeyPlugin } from "@/lib/auth/api-key-plugin";
import { dashboardBasePaths } from "@/lib/auth/base-paths";
import { twoFactorPlugin } from "@/lib/auth/two-factor-plugin";
import { authClient } from "@/lib/auth-client";

/**
 * Plugins decide which cards and views the vendored auth UI renders, so they
 * are registered here rather than passed to individual components. A plugin
 * that is not listed contributes no UI.
 */
export function AuthProviders({ children }: { children: ReactNode }) {
	const router = useRouter();

	return (
		<AuthProvider
			authClient={authClient}
			basePaths={dashboardBasePaths}
			Link={Link}
			navigate={({ to, replace }) =>
				replace ? router.replace(to) : router.push(to)
			}
			plugins={[apiKeyPlugin(), twoFactorPlugin()]}
			redirectTo="/dashboard"
			socialProviders={["google"]}
		>
			{children}
		</AuthProvider>
	);
}
