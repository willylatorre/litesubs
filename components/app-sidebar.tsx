"use client";

import {
	IconChecklist,
	IconCode,
	IconDashboard,
	IconHelpCircle,
	IconPackage,
	IconUsers,
	IconWallet,
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
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";

const data = {
	navSubscriptions: [
		{
			title: "Active Plans",
			url: "/dashboard",
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
			title: "Credit Plans",
			url: "/dashboard/packs",
			icon: IconPackage,
		},
		{
			title: "Payouts",
			url: "/dashboard/payouts",
			icon: IconWallet,
		},
		{
			title: "Customers",
			url: "/dashboard/customers",
			icon: IconUsers,
		},
		{
			title: "Developers",
			url: "/dashboard/developers",
			icon: IconCode,
		},
	],
	navSecondary: [
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
				{/* Active Subscriptions Group */}
				<SidebarGroup>
					<SidebarGroupLabel>My Account</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{data.navSubscriptions.map((item) => (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton asChild tooltip={item.title}>
										<Link href={item.url}>
											<item.icon />
											<span>{item.title}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				{/* Creator Group */}
				<NavMain items={data.navCreator} label="Creator" />

				<NavSecondary items={data.navSecondary} className="mt-auto" />
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
		</Sidebar>
	);
}
