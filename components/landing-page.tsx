"use client";

import { motion } from "framer-motion";
import { ArrowLeft, Check, ChevronDown, Copy, UserPlus } from "lucide-react";
import { useState } from "react";
import { PackItem } from "@/components/pack-item";
import { Button } from "@/components/ui/button";
import { AnimatedLogo } from "@/components/animated-logo";
import { CreatePackDemo, type DemoPackData } from "./landing/create-pack-demo";
import { CustomersTableDemo } from "./landing/customers-table-demo";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function LandingPage() {
	const defaultText =
		"This is a liteSub card. Hover over the card elements to see more details.";
	const [explanation, setExplanation] = useState(defaultText);

	// Demo State
	const [demoPack, setDemoPack] = useState<DemoPackData | null>(null);
	const [step, setStep] = useState(1);

	const handleCreatePack = (data: DemoPackData) => {
		setDemoPack(data);
		setStep(2);
		toast.success("Pack created successfully!");
	};

	const handleCopyLink = () => {
		navigator.clipboard.writeText(`https://litesubs.com/invite/demo-token`);
		toast.success("Link copied to clipboard");
	};

	const handleSimulatePurchase = () => {
		setStep(3);
		toast.success("New customer added!");
	};

	return (
		<main className="min-h-screen flex flex-col items-center px-6 py-12 gap-24">
			{/* Hero Section */}
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4, ease: "easeOut" }}
				className="w-full max-w-4xl text-center flex flex-col items-center gap-16"
			>
				<div className="flex flex-col items-center gap-4 max-w-xl">
					{/* Logo - Wrapped in h1 for SEO, styled to look normal */}
					<h1 className="sr-only">
						LiteSubs - Simple credit packs instead of heavy subscriptions
					</h1>
					<AnimatedLogo />

					{/* Description */}
					<p className="text-base md:text-lg text-muted-foreground">
						Simple credit packs instead of heavy subscriptions.
						<br />
						Buy credits, assign them to a person, and let them be used when
						needed.
					</p>
				</div>

				{/* Live Preview Section */}
				<motion.div
					initial={{ opacity: 0, scale: 0.95 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ delay: 0.2, duration: 0.4 }}
					className="w-full flex flex-col md:flex-row items-center justify-center gap-8 md:gap-12"
				>
					{/* Pack Item Card */}
					<div className="w-full max-w-sm relative group">
						<div className="absolute -inset-0.5 bg-gradient-to-r from-primary/20 to-primary/0 rounded-lg blur opacity-50 group-hover:opacity-100 transition duration-500"></div>
						<div className="relative bg-background rounded-lg shadow-xl">
							<PackItem
								product={{
									name: "250 Credit Pack",
									credits: 250,
									price: 12000,
									badge: "Active",
									description: "Simple pack of credits that you can consume.",
								}}
								className="border-primary/20 bg-background/50 backdrop-blur-xl"
								withEvents={true}
								readOnly={true}
								onCreditsHover={(hovering) =>
									setExplanation(
										hovering
											? "You decide the amount of credits and their expiration"
											: defaultText,
									)
								}
								onPriceHover={(hovering) =>
									setExplanation(
										hovering
											? "You pick the price your customers will pay for this pack"
											: defaultText,
									)
								}
							/>
						</div>
					</div>

					{/* Explanation Text */}
					<div className="flex items-start gap-3 text-left w-full max-w-[280px] h-[60px] shrink-0">
						<ArrowLeft className="text-muted-foreground/50 size-5 shrink-0 hidden md:block mt-0.5" />
						<p
							className="text-sm text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-left-2 duration-200"
							key={explanation}
						>
							{explanation}
						</p>
					</div>
				</motion.div>

				{/* CTA */}
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ delay: 0.35, duration: 0.3 }}
					className="flex flex-col items-center gap-3 mt-4"
				>
					<div className="flex gap-4">
						<Button size="lg" className="px-8" asChild variant="secondary">
							<a href="/dashboard">Go to dashboard</a>
						</Button>
					</div>
					<span className="text-xs text-muted-foreground">
						Free during early access
					</span>
				</motion.div>
			</motion.div>

			{/* How it Works Section */}
			<section className="w-full max-w-3xl flex flex-col items-center gap-12 pb-24">
				<div className="flex flex-col items-center gap-2 text-center">
					<h2 className="text-2xl font-bold tracking-tight">How it works</h2>
					<p className="text-muted-foreground">
						Set up your credit system in three simple steps.
					</p>
				</div>

				<div className="w-full grid gap-8 relative">
                    {/* Vertical Line */}
					<div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-border hidden md:block" />

					{/* Step 1 */}
					<div className="relative flex gap-6 md:gap-10">
						<div className="relative z-10 flex flex-col items-center">
							<div
								className={cn(
									"flex items-center justify-center w-10 h-10 rounded-full border-2 bg-background transition-colors duration-300",
									step >= 1
										? "border-primary text-primary"
										: "border-muted text-muted-foreground",
                                        step > 1 && "bg-primary text-primary-foreground border-primary"
								)}
							>
                                {step > 1 ? <Check className="w-5 h-5" /> : "1"}
							</div>
						</div>
						<div className="flex flex-col gap-4 pt-1 w-full">
							<h3 className="text-lg font-semibold">Create a Pack</h3>
							<p className="text-muted-foreground text-sm max-w-md">
								Define how many credits you want to sell and at what price.
							</p>
							<div className="mt-2">
								{demoPack ? (
									<div className="max-w-xs">
										<PackItem
											product={{
												name: demoPack.name,
												credits: demoPack.credits,
												price: demoPack.price * 100, // PackItem expects cents
												description: demoPack.description,
												currency: demoPack.currency,
                                                badge: "Created"
											}}
											readOnly
										/>
									</div>
								) : (
									<CreatePackDemo onCreate={handleCreatePack} />
								)}
							</div>
						</div>
					</div>

					{/* Step 2 */}
					<div className={cn("relative flex gap-6 md:gap-10 transition-opacity duration-500", step < 2 ? "opacity-50 grayscale pointer-events-none" : "opacity-100")}>
						<div className="relative z-10 flex flex-col items-center">
							<div
								className={cn(
									"flex items-center justify-center w-10 h-10 rounded-full border-2 bg-background transition-colors duration-300",
									step >= 2
										? "border-primary text-primary"
										: "border-muted text-muted-foreground",
                                        step > 2 && "bg-primary text-primary-foreground border-primary"
								)}
							>
								{step > 2 ? <Check className="w-5 h-5" /> : "2"}
							</div>
						</div>
						<div className="flex flex-col gap-4 pt-1 w-full">
							<h3 className="text-lg font-semibold">Share the Link</h3>
							<p className="text-muted-foreground text-sm max-w-md">
								Send the unique purchase link to your customers.
							</p>
							{step >= 2 && demoPack && (
								<div className="flex flex-col gap-3 max-w-sm mt-2">
									<div className="flex gap-2">
										<Input
											readOnly
											value={`https://litesubs.com/invite/${btoa(
												JSON.stringify(demoPack),
											).substring(0, 12)}...`}
											className="font-mono text-xs"
										/>
										<Button
											variant="outline"
											size="icon"
											onClick={handleCopyLink}
										>
											<Copy className="size-4" />
										</Button>
									</div>
									{step === 2 && (
										<Button onClick={handleSimulatePurchase} className="w-full" variant="secondary">
											<UserPlus className="mr-2 size-4" />
											Simulate Client Purchase
										</Button>
									)}
								</div>
							)}
						</div>
					</div>

					{/* Step 3 */}
					<div className={cn("relative flex gap-6 md:gap-10 transition-opacity duration-500", step < 3 ? "opacity-50 grayscale pointer-events-none" : "opacity-100")}>
						<div className="relative z-10 flex flex-col items-center">
							<div
								className={cn(
									"flex items-center justify-center w-10 h-10 rounded-full border-2 bg-background transition-colors duration-300",
									step >= 3
										? "border-primary text-primary"
										: "border-muted text-muted-foreground",
								)}
							>
								3
							</div>
						</div>
						<div className="flex flex-col gap-4 pt-1 w-full">
							<h3 className="text-lg font-semibold">Manage Customers</h3>
							<p className="text-muted-foreground text-sm max-w-md">
								View purchases and manage customer credits directly from your
								dashboard.
							</p>
							{step >= 3 && demoPack && (
								<div className="mt-2 w-full overflow-hidden">
									<CustomersTableDemo pack={demoPack} />
								</div>
							)}
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
