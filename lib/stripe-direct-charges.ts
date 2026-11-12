import { getStripe } from "@/lib/stripe";

/**
 * Server-only adapter for payments that happen **on a connected account**.
 *
 * Litesubs uses direct charges: the Checkout Session is created *as* the
 * connected account (the `Stripe-Account` request option), so the charge lives
 * on the creator's balance, the creator is the merchant of record, Stripe bills
 * them the processing fees, and refunds/chargebacks hit their account.
 *
 * This is deliberately not a destination charge. Adding
 * `payment_intent_data.transfer_data` would move the charge onto the Litesubs
 * platform balance and change who is liable, which is the opposite of the
 * agreed model. There is exactly one place that creates these sessions so the
 * two cannot drift apart.
 */

export type DirectChargeLineItem = {
	name: string;
	description?: string | null;
	/** Price in minor units of `currency`. */
	unitAmount: number;
	currency: string;
};

export type CreateDirectCheckoutInput = {
	stripeAccountId: string;
	lineItem: DirectChargeLineItem;
	/** Our 2% application fee, in minor units. */
	applicationFeeAmount: number;
	customerEmail?: string;
	successUrl: string;
	cancelUrl: string;
	metadata: Record<string, string>;
};

/**
 * The application fee must be strictly positive and less than the charge; a
 * zero or full-price fee is rejected by Stripe rather than silently ignored.
 */
export function isValidApplicationFee(
	amount: number,
	chargeAmount: number,
): boolean {
	return Number.isSafeInteger(amount) && amount > 0 && amount < chargeAmount;
}

export async function createDirectCheckoutSession(
	input: CreateDirectCheckoutInput,
) {
	const stripe = getStripe();
	return stripe.checkout.sessions.create(
		{
			mode: "payment",
			line_items: [
				{
					price_data: {
						currency: input.lineItem.currency,
						product_data: {
							name: input.lineItem.name,
							description: input.lineItem.description || undefined,
						},
						unit_amount: input.lineItem.unitAmount,
					},
					quantity: 1,
				},
			],
			...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			metadata: input.metadata,
			payment_intent_data: {
				// Fee only. No `transfer_data`: this stays a direct charge.
				application_fee_amount: input.applicationFeeAmount,
			},
		},
		// The connected account this session belongs to.
		{ stripeAccount: input.stripeAccountId },
	);
}
