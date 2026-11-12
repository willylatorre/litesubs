import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/app/db";
import { plans } from "@/app/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { resolvePublishedPlan } from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import {
	redeemCheckoutToken,
	startPurchase,
	startSubscription,
} from "@/lib/services/purchase";

function hashToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

function formatMoney(amount: number, currency: string) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(amount / 100);
}

/**
 * Redeem a creator's single-use purchase request.
 *
 * Sign-in happens first: the token is bound to the intended customer, so a
 * forwarded link cannot be used to buy against someone else's account. The
 * token is consumed only when the buyer actually continues to Checkout.
 */
export default async function PayPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(`/pay/${token}`)}`);
	}

	// Read without consuming so a page refresh does not burn the link.
	const pending = await db.query.checkoutTokens.findFirst({
		where: (table, { eq: equals }) => equals(table.tokenHash, hashToken(token)),
	});
	const invalid =
		!pending ||
		pending.userId !== session.user.id ||
		pending.consumedAt !== null ||
		pending.expiresAt.getTime() <= Date.now();

	if (invalid || !pending) {
		return (
			<Message
				title="This payment request is no longer valid"
				body="Ask the creator for a new link, or open the plan from your dashboard."
			/>
		);
	}

	const plan = await db.query.plans.findFirst({
		where: eq(plans.id, pending.planId),
	});
	if (!plan) {
		return (
			<Message
				title="This plan is no longer available"
				body="The creator removed it. Ask them for a new request."
			/>
		);
	}

	let terms: Awaited<ReturnType<typeof resolvePublishedPlan>>["terms"];
	try {
		({ terms } = await resolvePublishedPlan(pending.creatorId, plan.id));
	} catch {
		return (
			<Message
				title="This plan is not on sale right now"
				body="The creator has unpublished it. Ask them to publish it again."
			/>
		);
	}

	// Captured for the server action closure; the token is re-validated there.
	const creatorId = pending.creatorId;
	const planId = plan.id;

	async function pay() {
		"use server";
		const current = await auth.api.getSession({ headers: await headers() });
		if (!current?.user) redirect("/auth/sign-in");
		try {
			// Consumption happens here, so browsing the page does not burn the link
			// but a forwarded or replayed link cannot start a second checkout.
			await redeemCheckoutToken({
				token,
				userId: current.user.id,
			});
			const start =
				terms.billingMode === "recurring" ? startSubscription : startPurchase;
			const purchase = await start(sessionPrincipal(creatorId), {
				planId,
				userId: current.user.id,
			});
			if (purchase.url) redirect(purchase.url);
		} catch (error) {
			redirect(
				`${appUrl(`/pay/${token}`)}?error=${encodeURIComponent(
					error instanceof Error ? error.message : "Checkout failed",
				)}`,
			);
		}
	}

	return (
		<div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-4 p-6">
			<Card>
				<CardHeader>
					<Badge variant="outline" className="w-fit">
						Payment request
					</Badge>
					<CardTitle className="text-2xl">{plan.name}</CardTitle>
					<CardDescription>
						{plan.description ?? "Complete payment to receive your credits."}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-2">
					<div className="flex items-baseline justify-between">
						<span className="text-muted-foreground text-sm">Credits</span>
						<span className="font-mono">{terms.credits}</span>
					</div>
					<div className="flex items-baseline justify-between">
						<span className="text-muted-foreground text-sm">
							{terms.billingMode === "recurring" ? "Monthly" : "Total"}
						</span>
						<span className="text-xl font-bold">
							{formatMoney(terms.price, terms.currency)}
						</span>
					</div>
					<p className="text-muted-foreground text-xs">
						{terms.billingMode === "recurring"
							? "Your payment renews monthly. Each paid month grants this allowance; unused credits do not roll over and expire at the end of the paid month."
							: "You are paying the creator directly. Credits are added only after payment is confirmed."}
					</p>
				</CardContent>
				<CardFooter className="flex-col gap-2">
					<form action={pay} className="w-full">
						<Button type="submit" className="w-full">
							{terms.billingMode === "recurring" ? "Subscribe" : "Pay"}{" "}
							{formatMoney(terms.price, terms.currency)}
							{terms.billingMode === "recurring" ? " / month" : ""}
						</Button>
					</form>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/dashboard">Not now</Link>
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}

function Message({ title, body }: { title: string; body: string }) {
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-3 p-6">
			<h1 className="text-xl font-bold">{title}</h1>
			<p className="text-muted-foreground text-sm">{body}</p>
			<Button asChild variant="outline" className="w-fit">
				<Link href="/dashboard">Back to dashboard</Link>
			</Button>
		</div>
	);
}
