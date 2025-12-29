import Link from "next/link";
import { cn } from "@/lib/utils";

export function SiteFooter({ className }: { className?: string }) {
	return (
		<footer className={cn("py-3 md:py-0", className)}>
			<div className="container flex flex-col items-center justify-center gap-4 md:h-24 md:flex-row">
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
				{/* <div className="flex gap-4 text-sm text-muted-foreground">
					<Link href="/terms" className="hover:underline">
						Terms
					</Link>
					<Link href="/privacy" className="hover:underline">
						Privacy
					</Link>
				</div> */}
			</div>
		</footer>
	);
}
