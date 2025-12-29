"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
	const pathname = usePathname();

	const getPageTitle = (path: string) => {
		if (path === "/dashboard") return "Active Credit Plans";
		if (path.startsWith("/dashboard/creator")) return "Creator Dashboard";
		if (path.startsWith("/dashboard/customers")) return "Customers";
		if (path.startsWith("/dashboard/packs")) return "Credit Plans";
		if (path.startsWith("/dashboard/account")) return "Account";

		// Fallback: capitalize last segment
		const segments = path.split("/").filter(Boolean);
		const lastSegment = segments[segments.length - 1];
		return lastSegment
			? lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1)
			: "Dashboard";
	};

	return (
		<header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
			<div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
				<SidebarTrigger className="-ml-1" />
				<Separator
					orientation="vertical"
					className="mx-2 data-[orientation=vertical]:h-4"
				/>
				<h1 className="text-base font-medium">{getPageTitle(pathname)}</h1>
			</div>
		</header>
	);
}
