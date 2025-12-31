import type { ReactNode } from "react";
import { AuthProviders } from "./auth-providers";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return <AuthProviders>{children}</AuthProviders>;
}

