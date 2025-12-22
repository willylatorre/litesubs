"use client";

import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import { PackItem } from "@/components/pack-item";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProducts } from "@/hooks/use-products";

export function LivePacks() {
	const { data: products, isLoading } = useProducts();
	const livePacks = products?.filter((p) => p.active) || [];

	return (
		<Card className="flex flex-col">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<div className="grid gap-1">
					<CardTitle>Your Live Packs</CardTitle>
					<CardDescription>
						Packs currently available for purchase.
					</CardDescription>
				</div>
				<Button asChild variant="ghost" size="sm" className="hidden sm:flex">
					<Link href="/dashboard/packs">
						View All <IconArrowRight className="ml-2 size-4" />
					</Link>
				</Button>
			</CardHeader>
			<CardContent className="grid gap-4 pt-4">
				{isLoading ? (
					<div className="grid gap-4">
						{Array.from({ length: 3 }).map((_, i) => (
							<div
								key={i}
								className="flex items-center justify-between rounded-lg border p-3 shadow-sm"
							>
								<div className="space-y-1">
									<Skeleton className="h-4 w-[100px]" />
									<Skeleton className="h-3 w-[60px]" />
								</div>
								<Skeleton className="h-8 w-[80px]" />
							</div>
						))}
					</div>
				) : livePacks.length === 0 ? (
					<p className="text-sm text-muted-foreground">No active packs.</p>
				) : (
					<div className="grid gap-4">
						{livePacks.slice(0, 5).map((pack) => (
							<PackItem
								key={pack.id}
								product={{
									name: pack.name,
									credits: pack.credits,
									price: pack.price,
									description: pack.description,
									badge: "Active",
									currency: pack.currency,
								}}
								action={
									<Button asChild variant="outline" size="sm">
										<Link href={`/dashboard/packs`}>Manage</Link>
									</Button>
								}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
