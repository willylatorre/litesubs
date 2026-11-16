import Link from "next/link";
import { cn } from "@/lib/utils";

export function SiteFooter({ className }: { className?: string }) {
	return (
		<footer className={cn("py-3 md:py-0", className)}>
			<div className="container flex flex-col items-center justify-center gap-4 md:h-24 md:flex-row">
				<div className="flex flex-wrap items-center justify-center gap-4">
					<Link href="/docs" className="text-sm underline underline-offset-4">
						API & MCP docs
					</Link>
					<a href="/llms.txt" className="text-sm underline underline-offset-4">
						llms.txt
					</a>
					<Link href="/terms" className="text-sm underline underline-offset-4">
						Terms
					</Link>
					<Link
						href="/privacy"
						className="text-sm underline underline-offset-4"
					>
						Privacy
					</Link>
				</div>
				<div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
					<p className="text-center text-sm leading-loose text-muted-foreground md:text-left px-4">
						Made with <span className="text-red-500">❤️</span> by{" "}
						<Link
							href="https://x.com/willylatorre"
							target="_blank"
							rel="noreferrer"
							className="font-medium underline underline-offset-4"
						>
							A. Latorre
						</Link>
						.
					</p>
				</div>
			</div>
		</footer>
	);
}
