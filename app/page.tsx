"use client";

import { PackItem } from "@/components/pack-item";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

export default function Home() {
	const defaultText =
		"This is a liteSub card. Hover over the card elements to see more details.";
	const [explanation, setExplanation] = useState(defaultText);

	return (
		<main className="min-h-screen flex items-center justify-center px-6 py-12">
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4, ease: "easeOut" }}
				className="w-full max-w-4xl text-center flex flex-col items-center gap-16"
			>
				<div className="flex flex-col items-center gap-4 max-w-xl">
					{/* Title */}
					<h1 className="text-5xl md:text-6xl font-bold tracking-tight">
						LiteSubs
					</h1>

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
									price: 8500,
									badge: "Active",
									description: "Simple pack of credits that you can consume.",
								}}
								className="border-primary/20 bg-background/50 backdrop-blur-xl"
								onCreditsHover={(hovering) =>
									setExplanation(
										hovering ? "Credits are valid for 12 months." : defaultText,
									)
								}
								onPriceHover={(hovering) =>
									setExplanation(
										hovering
											? "One-time payment. No hidden fees."
											: defaultText,
									)
								}
								action={
									<Button
										variant="secondary"
										size="sm"
										className="pointer-events-none opacity-80 px-6"
									>
										Buy $120
									</Button>
								}
							/>
						</div>
					</div>

					{/* Explanation Text */}
					<div className="flex items-start gap-3 text-left w-full max-w-[280px] h-[60px] shrink-0">
						<ArrowLeft className="text-muted-foreground/50 size-5 shrink-0 hidden md:block mt-0.5" />
						<p className="text-sm text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-left-2 duration-200 key={explanation}">
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
						<Button size="lg" className="px-8" asChild>
							<a href="/dashboard">Go to dashboard</a>
						</Button>
						<Button size="lg" variant="outline" className="px-8" asChild>
							<a href="/auth/sign-in">Login</a>
						</Button>
					</div>
					<span className="text-xs text-muted-foreground">
						Free during early access
					</span>
				</motion.div>
			</motion.div>
		</main>
	);
}
