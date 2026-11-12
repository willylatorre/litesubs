import Link from "next/link";
import { getCalAccountStatus } from "@/app/actions/cal-com";
import { getPaymentsStatus } from "@/app/actions/stripe-connect";
import { CalIntegrationCard } from "@/components/integrations/cal-integration-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
	const [calAccountRes, paymentsRes] = await Promise.all([
		getCalAccountStatus(),
		getPaymentsStatus(),
	]);

	const calAccount = calAccountRes?.data;
	const readiness = paymentsRes?.data;
	const canSell = Boolean(readiness?.canSell);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
				<p className="text-sm text-muted-foreground">
					Manage external connections for bookings and payments.
				</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<CalIntegrationCard
					status={{
						connected: Boolean(calAccount),
						username: calAccount?.calUsername,
					}}
				/>

				<Card>
					<CardHeader className="flex flex-row items-start justify-between gap-4">
						<div>
							<CardTitle>Stripe payments</CardTitle>
							<CardDescription>
								Customers pay you directly on your own Stripe account.
							</CardDescription>
						</div>
						<Badge variant={canSell ? "default" : "secondary"}>
							{canSell
								? "Ready"
								: readiness?.hasAccount
									? "Needs attention"
									: "Not connected"}
						</Badge>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<p className="text-sm text-muted-foreground">
							{readiness?.hasAccount
								? "Review your readiness, resolve Stripe requirements, or open your Dashboard."
								: "Set up a Stripe account to start selling, or connect one you already use."}
						</p>
						<Button asChild variant="outline">
							<Link href="/dashboard/payments">Manage payments</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
