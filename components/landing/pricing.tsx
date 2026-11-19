"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";

/**
 * The rate is read from the same constant the charge path uses, so this section
 * cannot drift from what Stripe actually collects. A hard-coded percentage here would
 * survive a change to `PLATFORM_FEE_PERCENT` and quietly misprice the offer.
 */
const FEE_PERCENT_LABEL = `${PLATFORM_FEE_PERCENT * 100}%`;

/** A round number sells the arithmetic better than an odd one. */
const EXAMPLE_PRICE = 100;

function usd(amount: number) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(amount);
}

const included = [
	"Unlimited plans and customers",
	"Monthly allowances and one-time packs",
	"Bookings, API keys, webhooks and MCP",
	"No monthly fee or per-seat pricing",
];

export function Pricing() {
	const fee = EXAMPLE_PRICE * PLATFORM_FEE_PERCENT;
	const kept = EXAMPLE_PRICE - fee;

	const rows = [
		{ label: "Customer pays", value: usd(EXAMPLE_PRICE), muted: false },
		{
			label: `Litesubs fee (${FEE_PERCENT_LABEL})`,
			value: `−${usd(fee)}`,
			muted: true,
		},
	];

	return (
		<motion.section
			initial={{ opacity: 0, y: 20 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-100px" }}
			transition={{ duration: 0.5 }}
			className="w-full max-w-3xl"
			aria-labelledby="pricing-heading"
		>
			<div className="grid gap-10 md:grid-cols-[1.1fr_1fr] md:items-start md:gap-14">
				<div className="flex flex-col gap-5">
					<h2
						id="pricing-heading"
						className="text-2xl font-bold tracking-tight text-balance md:text-3xl"
					>
						We take {FEE_PERCENT_LABEL} of a sale. That is the whole price.
					</h2>
					<p className="text-muted-foreground">
						No subscription to use Litesubs, and no charge for publishing. The{" "}
						{FEE_PERCENT_LABEL} is collected as a Stripe application fee on each
						completed sale and appears as its own line in your Stripe Dashboard,
						next to the payment it came from.
					</p>
					<ul className="flex flex-col gap-2.5 pt-1">
						{included.map((item) => (
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

				{/* A receipt is the honest form for this: it shows where each cent
				    actually goes instead of asserting a percentage and hoping. */}
				<div className="rounded-xl border bg-card p-5 shadow-sm">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						On a {usd(EXAMPLE_PRICE)} sale
					</p>
					<dl className="mt-4 flex flex-col gap-3">
						{rows.map((row) => (
							<div
								key={row.label}
								className="flex items-baseline justify-between gap-4"
							>
								<dt className="text-sm text-muted-foreground">{row.label}</dt>
								<dd className="font-mono text-sm tabular-nums">{row.value}</dd>
							</div>
						))}
						<div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-3">
							<dt className="text-sm font-medium">
								Lands in your Stripe account
							</dt>
							<dd className="font-mono text-base font-semibold tabular-nums">
								{usd(kept)}
							</dd>
						</div>
					</dl>
					<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
						Stripe&apos;s own processing fee is charged to your account at
						Stripe&apos;s standard rates and is not part of the{" "}
						{FEE_PERCENT_LABEL}. You pay it directly, as any Stripe business
						does.
					</p>
				</div>
			</div>

			<p className="mt-8 text-sm text-muted-foreground">
				Free during early access. We will give notice before any change to the
				fee, and existing subscriptions keep the rate they were sold at.
			</p>
		</motion.section>
	);
}
