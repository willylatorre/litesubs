import type { Stripe } from "stripe";
import { getStripe } from "@/lib/stripe";

/** All subscription mutations run as the connected account that owns billing. */
export async function updateConnectedSubscription(input: {
	stripeAccountId: string;
	stripeSubscriptionId: string;
	cancelAtPeriodEnd: boolean;
	idempotencyKey: string;
}): Promise<Stripe.Subscription> {
	return getStripe().subscriptions.update(
		input.stripeSubscriptionId,
		{ cancel_at_period_end: input.cancelAtPeriodEnd },
		{
			stripeAccount: input.stripeAccountId,
			idempotencyKey: input.idempotencyKey,
		},
	);
}

/** Read current state when applying an asynchronous connected-account webhook. */
export async function retrieveConnectedSubscription(input: {
	stripeAccountId: string;
	stripeSubscriptionId: string;
}): Promise<Stripe.Subscription> {
	return getStripe().subscriptions.retrieve(
		input.stripeSubscriptionId,
		{},
		{ stripeAccount: input.stripeAccountId },
	);
}
