import { getBillingState } from "@/app/actions/billing";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { PremiumActions } from "./premium-actions";

export const dynamic = "force-dynamic";

const FREE_INCLUDED = [
	"2 plans — one-time packs only",
	"Unlimited customers and credit adjustments",
	"Your own Stripe account, no commission on sales",
];

const PREMIUM_INCLUDED = [
	"Unlimited plans",
	"Monthly and recurring plans",
	"API keys and webhooks",
	"No commission on sales",
];

function statusLabel(status: string) {
	switch (status) {
		case "active":
			return "Active";
		case "canceling":
			return "Cancels at period end";
		case "past_due":
			return "Payment failed";
		case "ended":
			return "Ended";
		default:
			return "Free";
	}
}

export default async function BillingPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const sp = await searchParams;
	const stateRes = await getBillingState();
	const state = stateRes.success ? stateRes.data : null;
	const entitlement = state?.entitlement;
	const configured = state?.configured ?? false;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Billing</h1>
				<p className="text-muted-foreground text-sm">
					What your liteSubs account includes. Sale payments are separate —
					those go straight to your own Stripe account, with no commission.
				</p>
			</div>

			{sp.upgraded === "true" && (
				<p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
					Thanks. Premium features unlock as soon as Stripe confirms the
					payment.
				</p>
			)}
			{sp.canceled === "true" && (
				<p className="text-muted-foreground text-sm">Checkout canceled.</p>
			)}

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader className="flex flex-row items-start justify-between gap-4">
						<div>
							<CardTitle>Free</CardTitle>
							<CardDescription>
								Everything you need to start selling.
							</CardDescription>
						</div>
						{entitlement?.tier === "free" && (
							<Badge variant="secondary">Current plan</Badge>
						)}
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<p className="text-2xl font-bold tracking-tight">$0</p>
						<ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
							{FREE_INCLUDED.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-start justify-between gap-4">
						<div>
							<CardTitle>Premium</CardTitle>
							<CardDescription>
								The whole product, monthly plans included.
							</CardDescription>
						</div>
						{entitlement?.tier === "premium" && (
							<Badge>{statusLabel(entitlement.status)}</Badge>
						)}
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<p className="text-2xl font-bold tracking-tight">
							$5
							<span className="text-muted-foreground text-sm font-normal">
								/month
							</span>
						</p>
						<ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
							{PREMIUM_INCLUDED.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
						<PremiumActions
							isPremium={entitlement?.tier === "premium"}
							configured={configured}
						/>
						{!configured && (
							<p className="text-xs text-muted-foreground">
								Premium checkout is not configured yet. Set
								<code className="mx-1">STRIPE_PREMIUM_PRICE_ID</code>
								to enable it.
							</p>
						)}
					</CardContent>
				</Card>
			</div>

			{entitlement && (
				<p className="text-sm text-muted-foreground">
					You have {entitlement.planCount}{" "}
					{entitlement.planCount === 1 ? "plan" : "plans"}
					{entitlement.planLimit !== null && ` of ${entitlement.planLimit}`}
					{entitlement.paidThroughAt &&
						` · Premium paid through ${entitlement.paidThroughAt.toLocaleDateString()}`}
				</p>
			)}
		</div>
	);
}
