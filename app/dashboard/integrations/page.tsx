import Link from "next/link";
import { getCalAccountStatus } from "@/app/actions/cal-com";
import { getConnectAccountStatus } from "@/app/actions/stripe-connect";
import { CalIntegrationCard } from "@/components/integrations/cal-integration-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
	const [calAccountRes, connectAccountRes] = await Promise.all([
		getCalAccountStatus(),
		getConnectAccountStatus(),
	]);

	const calAccount = calAccountRes?.data;
	const connectAccount = connectAccountRes?.data;
	const hasActiveConnect = connectAccount?.status === "active";

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
				<p className="text-sm text-muted-foreground">
					Manage external connections for bookings and payouts.
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
							<CardTitle>Stripe Connect</CardTitle>
							<CardDescription>
								Route customer payments directly to your Stripe account.
							</CardDescription>
						</div>
						<Badge variant={hasActiveConnect ? "default" : "secondary"}>
							{hasActiveConnect ? "Connected" : "Not connected"}
						</Badge>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<p className="text-sm text-muted-foreground">
							Open payouts to connect or manage your Stripe Connect account.
						</p>
						<Button asChild variant="outline">
							<Link href="/dashboard/payouts">Manage payouts</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
