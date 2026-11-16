"use client";

import {
	IconBook,
	IconCalendarEvent,
	IconChecklist,
	IconDashboard,
	IconHelpCircle,
	IconKey,
	IconPackage,
	IconPlug,
	IconUsers,
	IconWallet,
	IconWebhook,
} from "@tabler/icons-react";
import Link from "next/link";
import type * as React from "react";

import { AnimatedLogo } from "@/components/animated-logo";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

/**
 * Three groups, ordered by the creator's actual loop rather than by page type:
 *
 * 1. **My Account** — what the signed-in person has bought. One item, and it is
 *    the only thing here for someone who is purely a customer.
 * 2. **Creator** — the business, in the order it happens: overview, the offers,
 *    who buys them, then the plumbing that makes selling possible.
 * 3. **Developer** — machine-facing surfaces, kept separate so they do not read
 *    as day-to-day work.
 *
 * "Customers" sits directly under "Plans" because a plan without customers earns
 * nothing; integrations and settings are enablers, so they come after.
 */
const data = {
	navAccount: [
		{
			title: "Active Plans",
			url: "/dashboard",
			// `/dashboard` is also the parent of every tool page, so it must match
			// exactly or it would light on every route.
			match: ["/dashboard"],
			icon: IconChecklist,
		},
	],
	navCreator: [
		{
			title: "Dashboard",
			url: "/dashboard/creator",
			icon: IconDashboard,
		},
		{
			title: "Plans",
			url: "/dashboard/plans",
			icon: IconPackage,
		},
		{
			title: "Customers",
			url: "/dashboard/customers",
			icon: IconUsers,
		},
		{
			title: "Bookings",
			url: "/dashboard/bookings",
			icon: IconCalendarEvent,
		},
		{
			title: "Payments",
			url: "/dashboard/payments",
			icon: IconWallet,
		},
		{
			title: "Integrations",
			url: "/dashboard/integrations",
			icon: IconPlug,
		},
	],
	navDeveloper: [
		{
			title: "API Tokens",
			url: "/dashboard/developers/api-keys",
			icon: IconKey,
		},
		{
			// Existed but was never reachable from the sidebar.
			title: "Webhooks",
			url: "/dashboard/developers/webhooks",
			icon: IconWebhook,
		},
	],
	navSecondary: [
		{
			title: "API & MCP docs",
			url: "/docs",
			icon: IconBook,
		},
		{
			title: "FAQ",
			url: "/dashboard/faq",
			icon: IconHelpCircle,
		},
	],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	const session = authClient.useSession();
	const user = session.data?.user
		? {
				name: session.data.user.name,
				email: session.data.user.email,
				avatar: session.data.user.image || "",
			}
		: undefined;

	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							className="data-[slot=sidebar-menu-button]:!p-1.5 hover:bg-transparent active:bg-transparent"
						>
							<Link href="/" className="flex items-center gap-0">
								<AnimatedLogo
									iconClassName="size-6 md:size-6"
									textClassName="text-base font-semibold md:text-base tracking-normal"
								/>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={data.navAccount} label="My Account" />
				<NavMain items={data.navCreator} label="Creator" />
				<NavMain items={data.navDeveloper} label="Developer" />

				{/* Reference material stays pinned to the bottom, away from the loop. */}
				<NavSecondary items={data.navSecondary} className="mt-auto" />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
		</Sidebar>
	);
}
