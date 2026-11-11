import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { AnimatedLogo } from "@/components/animated-logo";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";

const links = [
	{ href: "/docs", label: "Docs" },
	{ href: "/sample", label: "Sample workspace" },
	{ href: "/docs#mcp", label: "MCP" },
	{ href: "/docs#api", label: "API" },
	{ href: "/dashboard", label: "Dashboard" },
];

/**
 * Shared frame for public pages (docs). Keeps them visually in the same family
 * as the dashboard and landing page instead of looking like a stray HTML file.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-screen flex-col bg-background">
			<header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
				<div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
					<Link href="/" className="shrink-0" aria-label="Litesubs home">
						<AnimatedLogo
							iconClassName="size-5"
							textClassName="text-lg font-semibold tracking-tight md:text-lg"
						/>
					</Link>
					<nav className="hidden items-center gap-1 text-sm md:flex">
						{links.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								{link.label}
							</Link>
						))}
					</nav>
					<div className="flex items-center gap-2">
						<Button
							asChild
							variant="ghost"
							size="sm"
							className="hidden sm:flex"
						>
							<Link href="/auth/sign-in">Sign in</Link>
						</Button>
						<Button asChild size="sm">
							<Link href="/auth/sign-up">
								Get started
								<ArrowUpRight className="size-3.5" />
							</Link>
						</Button>
					</div>
				</div>
			</header>

			<div className="flex-1">{children}</div>

			<div className="border-t">
				<SiteFooter />
			</div>
		</div>
	);
}
