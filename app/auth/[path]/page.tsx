import { viewPaths } from "@better-auth-ui/core";
import { twoFactorPlugin } from "@better-auth-ui/core/plugins/two-factor";
import { notFound } from "next/navigation";
import { AnimatedLogo } from "@/components/animated-logo";
import { Auth } from "@/components/auth/auth";

/**
 * Built-in auth paths plus the ones contributed by registered plugins. `Auth`
 * throws on an unknown path, so resolving the same set here turns a 500 into a
 * 404. The core plugin is imported rather than the vendored one because this is
 * a Server Component: the vendored wrapper pulls in client-only hooks.
 */
const validAuthPaths = new Set([
	...Object.values(viewPaths.auth),
	...Object.values(twoFactorPlugin().viewPaths?.auth ?? {}),
]);

export const dynamicParams = false;

export function generateStaticParams() {
	return [...validAuthPaths].map((path) => ({ path }));
}

export default async function AuthPage({
	params,
}: {
	params: Promise<{ path: string }>;
}) {
	const { path } = await params;

	if (!validAuthPaths.has(path)) notFound();

	return (
		<main className="container flex grow flex-col items-center justify-center self-center p-4 md:p-6 gap-8">
			<AnimatedLogo />
			<div className="w-full max-w-md">
				<Auth path={path} />
			</div>
		</main>
	);
}
