"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { StripeConnectDiagram } from "@/components/landing/stripe-connect-diagram";
import { Button } from "@/components/ui/button";

const points = [
	{
		title: "Your account, your customers",
		body: "Payments are direct charges on the Stripe account you connect. Customers, invoices and refunds live there, not inside liteSubs.",
	},
	{
		title: "Your full Dashboard",
		body: "Because the money lands on your account, you keep the normal Stripe Dashboard and your own payout schedule.",
	},
	{
		title: "Nothing sells until Stripe says it can",
		body: "Publishing checks the account's real capability, so an incomplete or restricted account cannot take a payment it cannot fulfil.",
	},
];

export function StripeConnect() {
	return (
		<motion.section
			initial={{ opacity: 0, y: 20 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-100px" }}
			transition={{ duration: 0.5 }}
			className="w-full max-w-4xl"
			aria-labelledby="connect-heading"
		>
			<div className="flex flex-col items-center gap-3 text-center">
				<h2
					id="connect-heading"
					className="text-2xl font-bold tracking-tight text-balance md:text-3xl"
				>
					Stripe Connect: the money never touches us
				</h2>
				<p className="max-w-xl text-balance text-muted-foreground">
					Connect lets you attach your own Stripe business, or start a new one,
					and get paid directly. liteSubs takes no cut of the sale and steps out
					of the flow.
				</p>
			</div>

			<div className="mt-10 flex justify-center rounded-2xl border bg-muted/30 px-4 py-8 md:px-10 md:py-10">
				<div className="w-full max-w-2xl">
					<StripeConnectDiagram />
				</div>
			</div>

			<dl className="mt-10 grid gap-8 md:grid-cols-3 md:gap-10">
				{points.map((point) => (
					<div key={point.title} className="flex flex-col gap-1.5">
						<dt className="text-sm font-semibold">{point.title}</dt>
						<dd className="text-sm leading-relaxed text-muted-foreground">
							{point.body}
						</dd>
					</div>
				))}
			</dl>

			<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
				<Button asChild variant="secondary">
					<Link href="/auth/sign-up">Connect Stripe</Link>
				</Button>
				<Button asChild variant="ghost">
					<Link href="/dashboard/faq">Read the payments FAQ</Link>
				</Button>
			</div>
		</motion.section>
	);
}
