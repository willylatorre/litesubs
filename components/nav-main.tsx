"use client";

import type { Icon } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Which nav item owns the current path.
 *
 * Longest match wins, so `/dashboard/developers/api-keys` lights "API Tokens"
 * rather than its parent "API & MCP". A nested area must not light two items:
 * the sidebar is the user's position indicator, and two highlights means none.
 */
export function activeNavUrl(pathname: string | null, urls: string[]) {
	if (!pathname) return null;
	// A URL ending in a segment is a prefix match: `/dashboard/plans` should light
	// for `/dashboard/plans/123`. The bare `/dashboard` is NOT a prefix of its own
	// children, or "Active Plans" would light on every tool page; it is listed in
	// `exact` instead.
	const matches = urls.filter((url) => {
		if (EXACT_ONLY.has(url)) return pathname === url;
		return pathname === url || pathname.startsWith(`${url}/`);
	});
	if (matches.length === 0) return null;
	return matches.reduce((best, url) => (url.length > best.length ? url : best));
}

/** Routes that are containers, not areas: only an exact hit lights them. */
const EXACT_ONLY = new Set(["/dashboard"]);

export function NavMain({
	items,
	label,
}: {
	items: {
		title: string;
		url: string;
		icon?: Icon;
		/** When set, only these prefixes light the item (see page.tsx for why). */
		match?: string[];
	}[];
	label?: string;
}) {
	const pathname = usePathname();
	const active = activeNavUrl(
		pathname,
		items.flatMap((item) => item.match ?? [item.url]),
	);

	return (
		<SidebarGroup>
			{label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
			<SidebarGroupContent className="flex flex-col gap-2">
				<SidebarMenu>
					{items.map((item) => {
						const isActive = (item.match ?? [item.url]).includes(active ?? "");
						return (
							<SidebarMenuItem key={item.title}>
								<SidebarMenuButton
									asChild
									tooltip={item.title}
									isActive={isActive}
								>
									<Link
										href={item.url}
										aria-current={isActive ? "page" : undefined}
									>
										{item.icon && <item.icon />}
										<span>{item.title}</span>
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
