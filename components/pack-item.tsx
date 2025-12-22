import { Coins } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { BuyButton } from "./buy-button";

export interface PackItemProduct {
	name: string;
	credits: number;
	price: number;
	description?: string | null;
	badge?: string | null;
	currency?: string;
}

interface PackItemProps {
	product: PackItemProduct;
	productId?: string;
	price?: number;
	className?: string;
	onCreditsHover?: (hovering: boolean) => void;
	onPriceHover?: (hovering: boolean) => void;
	creditsSuffix?: string;
	session?: any; // better-auth session
	loginUrl?: string;
	action?: React.ReactNode;
	creatorName?: string;
	withEvents?: boolean;
	readOnly?: boolean;
	isLoading?: boolean;
}

export function PackItem({
	product,
	productId,
	price,
	className,
	onCreditsHover,
	onPriceHover,
	creditsSuffix = " credits left",
	session,
	loginUrl,
	action,
	creatorName,
	withEvents = false,
	readOnly = false,
	isLoading = false,
}: PackItemProps) {
	const { name, credits, description, badge, currency = "usd" } = product;
	const finalPrice = price !== undefined ? price : product.price;

	const handleCreditsEnter = () => withEvents && onCreditsHover?.(true);
	const handleCreditsLeave = () => withEvents && onCreditsHover?.(false);
	const handlePriceEnter = () => withEvents && onPriceHover?.(true);
	const handlePriceLeave = () => withEvents && onPriceHover?.(false);

	const formattedPrice = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(finalPrice / 100);

	const renderAction = () => {
		if (action) return action;

		if (readOnly) {
			return (
				<Button size="lg" className="w-full pointer-events-none opacity-80">
					Buy {formattedPrice}
				</Button>
			);
		}

		if (!session && loginUrl) {
			return (
				<Button size="lg" className="w-full" asChild>
					<Link href={loginUrl}>Log in to Buy</Link>
				</Button>
			);
		}

		return (
			<BuyButton
				disabled={!productId}
				productId={productId}
				price={finalPrice}
				currency={currency}
				productName={name}
				label="Purchase credits"
			/>
		);
	};

	return (
		<Card
			className={cn(
				"relative flex flex-col justify-between p-3 shadow-xl border-0 font-sans h-full min-h-[200px]",
				className,
			)}
		>
			{isLoading && (
				<div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 rounded-lg">
					<Spinner />
				</div>
			)}
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

				<div className="flex flex-col items-start gap-1 w-full">
					<h3 className="text-lg font-bold">{name}</h3>
					{creatorName && (
						<p className="text-xs text-muted-foreground font-medium">
							Created by {creatorName}
						</p>
					)}
					{description && (
						<p className="text-sm text-muted-foreground mt-1">{description}</p>
					)}
				</div>
			</div>

			<div className="flex items-center justify-between gap-4 mt-4 w-full">
				<div
					className={cn(
						"text-sm font-bold",
						withEvents &&
							onCreditsHover &&
							"cursor-help hover:text-primary transition-colors",
					)}
					onMouseEnter={handleCreditsEnter}
					onMouseLeave={handleCreditsLeave}
				>
					{credits}
					<span className="text-sm font-normal text-muted-foreground ml-1">
						{creditsSuffix}
					</span>
				</div>
				<div onMouseEnter={handlePriceEnter} onMouseLeave={handlePriceLeave}>
					{renderAction()}
				</div>
			</div>
		</Card>
	);
}
