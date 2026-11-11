import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Callout({
	type = "note",
	title,
	children,
}: {
	type?: "note" | "warning" | "tip";
	title?: string;
	children: ReactNode;
}) {
	const styles = {
		note: "border-border bg-muted/40",
		warning: "border-secondary/70 bg-secondary/15",
		tip: "border-primary/25 bg-primary/5",
	}[type];

	return (
		<aside className={cn("rounded-xl border p-4 text-sm", styles)}>
			{title && <p className="mb-1 font-semibold">{title}</p>}
			<div className="text-muted-foreground [&_code]:text-foreground">
				{children}
			</div>
		</aside>
	);
}
