"use client";

import {
	IconCheck,
	IconCoin,
	IconLoader2,
	IconSparkles,
	IconTrash,
	IconUsers,
} from "@tabler/icons-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	createSampleWorkspace,
	removeSampleWorkspace,
	type SampleWorkspaceState,
} from "@/app/actions/sample-data";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
	initialSample: SampleWorkspaceState;
	isEmpty: boolean;
	totalPlans: number;
	totalCustomers: number;
}

/**
 * First-run guidance. Without it a new creator lands on three empty tables and
 * has to guess the order of operations.
 */
export function GettingStarted({
	initialSample,
	isEmpty,
	totalPlans,
	totalCustomers,
}: Props) {
	const [sample, setSample] = useState(initialSample);
	const [pending, startTransition] = useTransition();
	const [busy, setBusy] = useState<"create" | "remove" | null>(null);

	function loadSample() {
		setBusy("create");
		startTransition(async () => {
			const result = await createSampleWorkspace();
			if (result.success && result.data) {
				setSample(result.data);
				toast.success("Sample plan and customer added");
			} else {
				toast.error(result.error ?? "Could not load the sample workspace");
			}
			setBusy(null);
		});
	}

	function removeSample() {
		setBusy("remove");
		startTransition(async () => {
			const result = await removeSampleWorkspace();
			if (result.success) {
				setSample({ loaded: false, planId: null, customerId: null });
				toast.success("Sample data removed");
			} else {
				toast.error(result.error ?? "Could not remove the sample data");
			}
			setBusy(null);
		});
	}

	// Once the creator has real data and no sample, the checklist has done its job.
	if (!isEmpty && !sample.loaded) return null;

	return (
		<Card className="mx-4 border-primary/20 bg-primary/[0.03] lg:mx-6">
			<CardHeader className="pb-3">
				<div className="flex items-center gap-2">
					<IconSparkles className="size-4 text-primary" />
					<CardTitle className="text-base">Getting started</CardTitle>
				</div>
				<CardDescription>
					{sample.loaded
						? "You are looking at a sample plan and a sample customer. Poke around, then replace them with your own."
						: "Three steps from an idea to a paying customer. Or load a filled-in example to see how everything fits together."}
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-4">
				<ol className="grid gap-2 text-sm sm:grid-cols-3">
					{[
						{
							n: 1,
							label: "Create a plan",
							done: sample.loaded || totalPlans > 0,
							href: "/dashboard/plans",
						},
						{
							n: 2,
							label: "Connect payments",
							done: false,
							href: "/dashboard/payments",
						},
						{
							n: 3,
							label: "Enroll a customer",
							done: sample.loaded || totalCustomers > 0,
							href: "/dashboard/customers",
						},
					].map((step) => (
						<li key={step.n}>
							<Link
								href={step.href}
								className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 transition-colors hover:border-primary/40"
							>
								<span
									className={cn(
										"flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
										step.done
											? "bg-primary text-primary-foreground"
											: "bg-primary/10 text-primary",
									)}
								>
									{step.done ? <IconCheck className="size-3" /> : step.n}
								</span>
								<span
									className={cn(
										"font-medium",
										step.done && "text-muted-foreground line-through",
									)}
								>
									{step.label}
								</span>
							</Link>
						</li>
					))}
				</ol>

				<div className="flex flex-wrap items-center gap-2 border-t pt-4">
					{sample.loaded ? (
						<>
							<Button asChild variant="outline" size="sm">
								<Link href="/dashboard/customers">
									<IconUsers className="size-4" />
									See the sample customer
								</Link>
							</Button>
							<Button asChild variant="outline" size="sm">
								<Link href="/dashboard/plans">
									<IconCoin className="size-4" />
									See the sample plan
								</Link>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={removeSample}
								disabled={pending || busy !== null}
								className="text-muted-foreground"
							>
								{busy === "remove" ? (
									<IconLoader2 className="size-4 animate-spin" />
								) : (
									<IconTrash className="size-4" />
								)}
								Remove sample data
							</Button>
						</>
					) : (
						<Button
							size="sm"
							onClick={loadSample}
							disabled={pending || busy !== null}
						>
							{busy === "create" ? (
								<IconLoader2 className="size-4 animate-spin" />
							) : (
								<IconSparkles className="size-4" />
							)}
							Load sample plan &amp; customer
						</Button>
					)}
					<span className="text-xs text-muted-foreground">
						Sample data is labelled and can be removed at any time.
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
