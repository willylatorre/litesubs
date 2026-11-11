import { ArrowRight, Coins, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/docs/code-block";
import { PublicShell } from "@/components/public-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
	title: "Sample workspace | Litesubs",
	description:
		"A filled-in Litesubs workspace: one credit plan, one enrolled customer, and the ledger behind their balance.",
};

const plan = {
	name: "Algebra Tutoring",
	credits: 10,
	price: 10_000,
	description: "Ten tutoring credits, used one session at a time.",
};

const ledger = [
	{
		date: "2 weeks ago",
		type: "Purchase",
		reason: "Bought Algebra Tutoring",
		amount: 10,
		balance: 10,
	},
	{
		date: "1 week ago",
		type: "Usage",
		reason: "Lesson completed",
		amount: -4,
		balance: 6,
	},
];

export default function SampleWorkspacePage() {
	const remaining = 6;

	return (
		<PublicShell>
			<main className="mx-auto w-full max-w-5xl px-4 py-12 md:px-6 md:py-16">
				<header className="max-w-2xl space-y-3">
					<Badge variant="secondary" className="gap-1">
						<Sparkles className="size-3" />
						Sample workspace
					</Badge>
					<h1 className="text-3xl font-bold tracking-tight md:text-4xl">
						This is what your dashboard looks like
					</h1>
					<p className="text-muted-foreground md:text-lg">
						One plan, one customer, one ledger. No sign-up needed to look around
						— and the same example can be loaded into your account with a single
						click.
					</p>
					<div className="flex flex-wrap gap-3 pt-1">
						<Button asChild size="lg">
							<Link href="/auth/sign-up">
								Start with this sample
								<ArrowRight className="size-4" />
							</Link>
						</Button>
						<Button asChild size="lg" variant="outline">
							<Link href="/docs">Read the docs</Link>
						</Button>
					</div>
				</header>

				<div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
					<Card className="h-fit">
						<CardHeader className="pb-2">
							<div className="flex items-center justify-between">
								<span className="rounded-full text-primary">
									<Coins className="size-5" />
								</span>
								<Badge variant="outline">Active</Badge>
							</div>
							<CardTitle className="pt-3 text-lg">{plan.name}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<p className="text-sm text-muted-foreground">
								{plan.description}
							</p>
							<div className="flex items-center justify-between border-t pt-3 text-sm">
								<span className="font-bold">
									{plan.credits}
									<span className="ml-1 font-normal text-muted-foreground">
										credits
									</span>
								</span>
								<span className="font-bold">
									{new Intl.NumberFormat("en-US", {
										style: "currency",
										currency: "USD",
									}).format(plan.price / 100)}
								</span>
							</div>
						</CardContent>
					</Card>

					<div className="space-y-6">
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-base">Customer</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex items-center justify-between gap-4">
									<div className="flex items-center gap-3">
										<span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
											AR
										</span>
										<div>
											<p className="text-sm font-medium">Ana Rivera</p>
											<p className="text-xs text-muted-foreground">
												ana.rivera@example.com
											</p>
										</div>
									</div>
									<div className="text-right">
										<p className="font-mono text-lg leading-none">
											{remaining}
										</p>
										<p className="text-[10px] uppercase tracking-wider text-muted-foreground">
											credits left
										</p>
									</div>
								</div>

								<div className="overflow-x-auto rounded-lg border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>When</TableHead>
												<TableHead>Reason</TableHead>
												<TableHead className="text-right">Change</TableHead>
												<TableHead className="text-right">Balance</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{ledger.map((row) => (
												<TableRow key={row.reason}>
													<TableCell className="whitespace-nowrap text-xs text-muted-foreground">
														{row.date}
													</TableCell>
													<TableCell className="text-sm">
														<span className="mr-1.5 text-xs capitalize text-muted-foreground">
															{row.type} ·
														</span>
														{row.reason}
													</TableCell>
													<TableCell
														className={`text-right font-mono text-xs ${
															row.amount > 0 ? "text-green-700" : "text-red-600"
														}`}
													>
														{row.amount > 0 ? "+" : ""}
														{row.amount}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{row.balance}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
								<p className="text-xs text-muted-foreground">
									Every credit change is a ledger row with a reason, a
									before/after balance, and an idempotency key so retries never
									double-charge.
								</p>
							</CardContent>
						</Card>

						<div className="space-y-2">
							<h2 className="text-sm font-semibold">
								The call your app makes for each lesson
							</h2>
							<CodeBlock
								language="curl · consume one credit"
								code={`curl -X POST 'https://litesubs.com/api/v1/credits/consume' \\
  -H 'x-api-key: <your token>' \\
  -H 'Content-Type: application/json' \\
  -d '{"customer":"ana.rivera@example.com","plan":"Algebra Tutoring","amount":1,"reason":"Lesson completed","idempotency_key":"booking_8812"}'`}
							/>
						</div>
					</div>
				</div>

				<section className="mt-14 rounded-2xl border bg-muted/40 p-6 md:p-8">
					<div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
						<div className="max-w-lg space-y-2">
							<h2 className="text-xl font-semibold tracking-tight">
								Load this into your own account
							</h2>
							<p className="text-sm text-muted-foreground">
								Sign up, then press <em>Load sample plan &amp; customer</em> on
								the creator dashboard. Everything above appears as real,
								editable data, labelled as a sample and removable in one click.
							</p>
						</div>
						<Button asChild size="lg" className="shrink-0">
							<Link href="/auth/sign-up">
								Create a free account
								<ArrowRight className="size-4" />
							</Link>
						</Button>
					</div>
				</section>
			</main>
		</PublicShell>
	);
}
