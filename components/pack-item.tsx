import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";
import Link from "next/link";

export interface PackItemProduct {
	name: string;
	credits: number;
	price: number;
	description?: string | null;
	badge?: string | null;
}

interface PackItemProps {
	product: PackItemProduct;
	action?: React.ReactNode;
	className?: string;
	onCreditsHover?: (hovering: boolean) => void;
	onPriceHover?: (hovering: boolean) => void;
	creditsSuffix?: string;
	session?: any; // better-auth session
	loginUrl?: string;
}

export function PackItem({
	product,
	action,
	className,
	onCreditsHover,
	onPriceHover,
	creditsSuffix = " credits left",
	session,
	loginUrl,
}: PackItemProps) {
	const { name, credits, price, description, badge } = product;

	return (
		<Card
			className={cn(
				"relative flex flex-col justify-between p-3 shadow-xl border-0 font-sans h-full min-h-[200px]",
				className,
			)}
		>
			<div className="flex flex-col items-start gap-4">
				<div className="flex items-center justify-between w-full">
					<div className="rounded-full text-primary">
						<Coins className="h-5 w-5" />
					</div>
					{badge && (
						<Badge
							variant="outline"
							className="text-muted-foreground font-normal"
						>
							{badge}
						</Badge>
					)}
				</div>

				<div className="flex flex-col items-start gap-2 w-full">
					<h3 className="text-lg font-bold">{name}</h3>
					<p className="text-sm text-left text-muted-foreground leading-relaxed">
						{description || "Get started with a simple credit pack."}
					</p>
				</div>
			</div>

			<div className="flex items-center justify-between mt-6">
				<span
					className={cn(
						"text-sm font-medium text-muted-foreground",
						onCreditsHover &&
							"cursor-help hover:text-foreground transition-colors",
					)}
					onMouseEnter={() => onCreditsHover?.(true)}
					onMouseLeave={() => onCreditsHover?.(false)}
				>
					{credits}{creditsSuffix}
				</span>
				<div
					onMouseEnter={() => onPriceHover?.(true)}
					onMouseLeave={() => onPriceHover?.(false)}
				>
					{session === null && loginUrl ? (
						<Button size="sm" asChild>
							<Link href={loginUrl}>Log in to Buy</Link>
						</Button>
					) : (
						action
					)}
				</div>
			</div>
		</Card>
	);
}
