import type { Stripe } from "stripe";
import { getStripe } from "@/lib/stripe";

/**
 * Read succeeded refunds for one charge on the account that owns it.
 *
 * `charge.refunded` carries a cumulative total, so reconciling from it alone
 * replays earlier refunds. Listing the refund objects gives each refund its
 * own stable id and amount, which is the idempotency boundary the service uses.
 */
export async function listConnectedChargeRefunds(input: {
	stripeAccountId: string;
	stripeChargeId: string;
}): Promise<Stripe.Refund[]> {
	const list = await getStripe().refunds.list(
		{ charge: input.stripeChargeId, limit: 100 },
		{ stripeAccount: input.stripeAccountId },
	);
	return list.data;
}

/**
 * The local payment id recorded on the PaymentIntent when Checkout was created.
 * This is the fallback correlation for a refund that arrives before the
 * confirming webhook has stored the PaymentIntent on the receipt.
 */
export async function connectedPaymentIdForIntent(input: {
	stripeAccountId: string;
	paymentIntentId: string;
}): Promise<string | null> {
	try {
		const intent = await getStripe().paymentIntents.retrieve(
			input.paymentIntentId,
			{},
			{ stripeAccount: input.stripeAccountId },
		);
		return intent.metadata?.paymentId ?? null;
	} catch {
		return null;
	}
}
