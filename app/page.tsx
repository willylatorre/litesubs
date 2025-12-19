"use client";

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
	return (
		<main className="min-h-screen flex items-center justify-center px-6">
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4, ease: "easeOut" }}
				className="w-full max-w-xl text-center flex flex-col items-center gap-8"
			>
				{/* Title */}
				<h1 className="text-5xl md:text-6xl font-bold tracking-tight">
					LiteSubs
				</h1>

				{/* Description */}
				<p className="text-base md:text-lg text-muted-foreground max-w-md">
					Simple credit packs instead of heavy subscriptions.
					<br />
					Buy credits, assign them to a person, and let them be used when
					needed.
				</p>

				{/* Visual placeholder */}
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ delay: 0.2, duration: 0.3 }}
					className="w-full h-40 rounded-xl border border-dashed border-muted flex items-center justify-center text-xs text-muted-foreground"
				>
					Product preview
				</motion.div>

				{/* CTA */}
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ delay: 0.35, duration: 0.3 }}
					className="flex flex-col items-center gap-2"
				>
					<Button size="lg" className="px-10" asChild>
						<a href="/dashboard">Go to dashboard</a>
					</Button>
					<Button size="lg" className="px-10" asChild>
						<a href="/auth/sign-in">Go to login</a>
					</Button>
					<span className="text-xs text-muted-foreground">
						Free during early access
					</span>
				</motion.div>
			</motion.div>
		</main>
	);
}
