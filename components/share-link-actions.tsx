"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyToClipboard, shareLink } from "@/lib/share-link";

interface ShareLinkActionsProps {
	/** Absolute URL. Relative links cannot be shared sensibly. */
	url: string;
	title?: string;
	text?: string;
	/** Icon-only buttons, for a row in a table or list. */
	compact?: boolean;
	className?: string;
}

/**
 * Copy and share a link in one place.
 *
 * Every link liteSubs generates is meant to be forwarded by the creator, so the
 * share sheet (mobile) and the clipboard (desktop) belong side by side on each
 * one rather than being reinvented per dialog.
 */
export function ShareLinkActions({
	url,
	title,
	text,
	compact = false,
	className,
}: ShareLinkActionsProps) {
	const [copied, setCopied] = useState(false);
	// Server and first client render must agree, so this starts false and flips
	// after mount. A browser without the share sheet simply never shows the
	// button, and copy is always available.
	const [canShare, setCanShare] = useState(false);

	useEffect(() => {
		setCanShare(
			typeof navigator !== "undefined" && typeof navigator.share === "function",
		);
	}, []);

	async function handleCopy() {
		if (await copyToClipboard(url)) {
			setCopied(true);
			toast.success("Link copied to clipboard");
			setTimeout(() => setCopied(false), 2000);
		} else {
			toast.error("Could not copy the link");
		}
	}

	async function handleShare() {
		const result = await shareLink({ url, title, text });
		if (result === "copied") toast.success("Link copied to clipboard");
		if (result === "failed") toast.error("Could not share the link");
		// "shared" needs no toast: the share sheet already confirmed it, and
		// "cancelled" is a decision, not a failure.
	}

	const size = compact ? "icon-sm" : "sm";

	return (
		<div className={className ?? "flex items-center gap-2"}>
			<Button
				variant="outline"
				size={size}
				onClick={handleCopy}
				aria-label="Copy link"
				title="Copy link"
			>
				{copied ? (
					<Check className={compact ? "size-4" : "size-4 text-green-600"} />
				) : (
					<Copy className="size-4" />
				)}
				{!compact && (copied ? "Copied" : "Copy")}
			</Button>
			{canShare && (
				<Button
					variant={compact ? "outline" : "default"}
					size={size}
					onClick={handleShare}
					aria-label="Share link"
					title="Share link"
				>
					<Share2 className="size-4" />
					{!compact && "Share"}
				</Button>
			)}
		</div>
	);
}
