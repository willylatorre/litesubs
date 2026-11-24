"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

/**
 * The whole price. Two things changed from the commission model and both are
 * load-bearing for this copy: a sale is no longer taxed at all, and the platform
 * is paid for by a flat monthly plan. Numbers are literals here rather than a
 * shared constant because they are *copy* — the charge path reads its own
 * configuration, and a mismatch is a product decision, not a formatting bug.
 */

const FREE_FEATURES = [
	"2 plans — one-time packs",
	"Unlimited customers and credit adjustments",
	"Your own Stripe account",
	"No commission on sales",
];

const PREMIUM_FEATURES = [
	"Unlimited plans",
	"Monthly and recurring plans",
	"API keys and webhooks",
	"No commission on sales",
];

export function Pricing() {
	return (
		<motion.section
			initial={{ opacity: 0, y: 20 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-100px" }}
			transition={{ duration: 0.5 }}
			className="w-full max-w-3xl"
			aria-labelledby="pricing-heading"
		>
			<div className="flex flex-col gap-5 text-center">
				<h2
					id="pricing-heading"
					className="text-2xl font-bold tracking-tight text-balance md:text-3xl"
				>
					No commission. Start free, or $5 a month for everything.
				</h2>
				<p className="mx-auto max-w-xl text-muted-foreground">
					Customers pay you directly on your own Stripe account and you keep the
					whole sale. liteSubs charges you a subscription, never a percentage of
					what you sell.
				</p>
			</div>

			<div className="mt-10 grid gap-4 md:grid-cols-2">
				<div className="rounded-xl border bg-card p-6 shadow-sm">
					<p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
						Free
					</p>
					<p className="mt-2 font-mono text-3xl font-semibold tabular-nums">
						$0
					</p>
					<ul className="mt-6 flex flex-col gap-2.5">
						{FREE_FEATURES.map((item) => (
							<li key={item} className="flex items-start gap-2.5 text-sm">
								<Check
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-primary"
								/>
								<span>{item}</span>
							</li>
						))}
					</ul>
				</div>

				<div className="relative rounded-xl border-2 border-primary bg-card p-6 shadow-sm">
					<div className="flex items-baseline justify-between gap-4">
						<p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
							Premium
						</p>
						<span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
							Unlimited
						</span>
					</div>
					<p className="mt-2 font-mono text-3xl font-semibold tabular-nums">
						$5
						<span className="text-base font-normal text-muted-foreground">
							/month
						</span>
					</p>
					<ul className="mt-6 flex flex-col gap-2.5">
						{PREMIUM_FEATURES.map((item) => (
							<li key={item} className="flex items-start gap-2.5 text-sm">
								<Check
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-primary"
								/>
								<span>{item}</span>
							</li>
						))}
					</ul>
				</div>
			</div>

			<p className="mt-8 text-center text-sm text-muted-foreground">
				Stripe&apos;s own processing fee applies to each sale at Stripe&apos;s
				standard rates and is charged to your account — not to us. Change plans
				or cancel any time.
			</p>
		</motion.section>
	);
}
