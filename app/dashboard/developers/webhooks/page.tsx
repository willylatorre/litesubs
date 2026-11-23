import {
	getWebhookDeliveries,
	getWebhookEndpoints,
} from "@/app/actions/webhooks";
import {
	WEBHOOK_EVENT_LABELS,
	WEBHOOK_EVENT_TYPES,
} from "@/lib/webhook-events";
import { WebhookDeliveries } from "./webhook-deliveries";
import { WebhookEndpoints } from "./webhook-endpoints";

export const metadata = {
	title: "Webhooks | liteSubs",
	description:
		"Notify your own services when a pack is purchased or a credit balance changes.",
};

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
	const [endpointsRes, deliveriesRes] = await Promise.all([
		getWebhookEndpoints(),
		getWebhookDeliveries({ limit: 25 }),
	]);

	return (
		<div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 lg:px-6">
			<header className="space-y-2">
				<h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
				<p className="text-sm text-muted-foreground">
					Send a signed HTTP request to your own service when a customer buys a
					pack or their balance changes. Delivery is best-effort at the moment
					of the change; failures are recorded and can be re-sent here.
				</p>
			</header>

			<section className="space-y-3 rounded-lg border p-4">
				<h2 className="text-sm font-semibold">What gets sent</h2>
				<ul className="space-y-1 text-sm text-muted-foreground">
					{WEBHOOK_EVENT_TYPES.map((type) => (
						<li key={type}>
							<code className="rounded bg-muted px-1 py-0.5 text-xs">
								{type}
							</code>{" "}
							— {WEBHOOK_EVENT_LABELS[type]}
						</li>
					))}
				</ul>
				<p className="text-xs text-muted-foreground">
					Every payload includes the event id, type, creator id, customer id,
					plan id, the credit delta, and the resulting balance. If the movement
					was a paid purchase it also includes the amount in minor units and the
					currency. No Stripe secrets, tokens, emails, or names are sent.
				</p>
			</section>

			<WebhookEndpoints
				initialEndpoints={endpointsRes.data ?? []}
				error={endpointsRes.error}
			/>

			<WebhookDeliveries
				initialDeliveries={deliveriesRes.data ?? []}
				error={deliveriesRes.error}
			/>
		</div>
	);
}
