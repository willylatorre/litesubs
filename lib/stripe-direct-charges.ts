import { getStripe } from "@/lib/stripe";

/**
 * Server-only adapter for payments that happen **on a connected account**.
 *
 * liteSubs uses direct charges: the Checkout Session is created *as* the
 * connected account (the `Stripe-Account` request option), so the charge lives
 * on the creator's balance, the creator is the merchant of record, Stripe bills
 * them the processing fees, and refunds/chargebacks hit their account.
 *
 * This is deliberately not a destination charge. Adding
 * `payment_intent_data.transfer_data` would move the charge onto the liteSubs
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
	/**
	 * A published plan version's Stripe Price. When present it is used directly,
	 * so the charge is provably the frozen offer rather than an ad-hoc amount.
	 */
	stripePriceId?: string | null;
};

export type CreateDirectCheckoutInput = {
	stripeAccountId: string;
	lineItem: DirectChargeLineItem;
	customerEmail?: string;
	/** Reuse the creator's Stripe Customer for this buyer when one exists. */
	stripeCustomerId?: string | null;
	successUrl: string;
	cancelUrl: string;
	metadata: Record<string, string>;
	/** Retry-safe key; a repeated create returns the original session. */
	idempotencyKey?: string;
};

export type CreateSubscriptionCheckoutInput = CreateDirectCheckoutInput;

export async function createDirectCheckoutSession(
	input: CreateDirectCheckoutInput,
) {
	const stripe = getStripe();
	return stripe.checkout.sessions.create(
		{
			mode: "payment",
			line_items: [
				{
					// A published version's Price is used directly when we have it:
					// the charge is then exactly the frozen offer we committed to.
					...(input.lineItem.stripePriceId
						? { price: input.lineItem.stripePriceId }
						: {
								price_data: {
									currency: input.lineItem.currency,
									product_data: {
										name: input.lineItem.name,
										description: input.lineItem.description || undefined,
									},
									unit_amount: input.lineItem.unitAmount,
								},
							}),
					quantity: 1,
				},
			],
			// A Customer created on this account is the only one that may be
			// referenced here; a platform Customer id would belong to another scope.
			...(input.stripeCustomerId
				? { customer: input.stripeCustomerId }
				: input.customerEmail
					? { customer_email: input.customerEmail }
					: {}),
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			metadata: input.metadata,
			// No `application_fee_amount` and no `transfer_data`: this is a plain
			// direct charge and the creator keeps the whole sale. liteSubs is paid
			// for by a creator subscription (`docs/REFOCUS.md`), never by a cut.
			payment_intent_data: { metadata: input.metadata },
		},
		{
			// The connected account this session belongs to.
			stripeAccount: input.stripeAccountId,
			...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
		},
	);
}

/**
 * Create a monthly subscription through direct-charge Checkout. The request is
 * scoped to the creator account. No platform fee is attached: the creator keeps
 * the whole sale and liteSubs is paid for by a creator subscription.
 */
export async function createDirectSubscriptionCheckoutSession(
	input: CreateSubscriptionCheckoutInput,
) {
	if (!input.lineItem.stripePriceId)
		throw new Error("A published Stripe Price is required for subscriptions");
	const stripe = getStripe();
	return stripe.checkout.sessions.create(
		{
			mode: "subscription",
			line_items: [
				{
					price: input.lineItem.stripePriceId,
					quantity: 1,
				},
			],
			...(input.stripeCustomerId
				? { customer: input.stripeCustomerId }
				: input.customerEmail
					? { customer_email: input.customerEmail }
					: {}),
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			metadata: input.metadata,
			subscription_data: { metadata: input.metadata },
		},
		{
			stripeAccount: input.stripeAccountId,
			...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
		},
	);
}

/**
 * Create or reuse the buyer's Stripe Customer **on the creator's account**.
 *
 * Stripe Customers are account-scoped: the same person is a different Customer
 * for every creator, so a platform Customer can never be passed here.
 */
export async function createConnectedCustomer(input: {
	stripeAccountId: string;
	email: string;
	name?: string | null;
	metadata: Record<string, string>;
	idempotencyKey?: string;
}) {
	const stripe = getStripe();
	const customer = await stripe.customers.create(
		{
			email: input.email,
			...(input.name ? { name: input.name } : {}),
			metadata: input.metadata,
		},
		{
			stripeAccount: input.stripeAccountId,
			...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
		},
	);
	return { id: customer.id };
}
