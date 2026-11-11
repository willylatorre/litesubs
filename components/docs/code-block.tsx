"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
	code: string;
	language?: string;
	className?: string;
	/** Hide the copy button when the block is illustrative rather than runnable. */
	copyable?: boolean;
}

export function CodeBlock({
	code,
	language,
	className,
	copyable = true,
}: CodeBlockProps) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			toast.success("Copied to clipboard");
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toast.error("Could not copy. Select the text instead.");
		}
	}

	return (
		<div
			className={cn(
				"group relative overflow-hidden rounded-xl border bg-muted/40",
				className,
			)}
		>
			<div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
				<span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
					{language ?? "shell"}
				</span>
				{copyable && (
					<button
						type="button"
						onClick={copy}
						className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
						aria-label="Copy code"
					>
						{copied ? (
							<Check className="size-3.5" />
						) : (
							<Copy className="size-3.5" />
						)}
						{copied ? "Copied" : "Copy"}
					</button>
				)}
			</div>
			<pre className="overflow-x-auto px-4 py-3.5 text-[13px] leading-relaxed">
				<code>{code}</code>
			</pre>
		</div>
	);
}
