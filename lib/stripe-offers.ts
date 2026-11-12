import { createHash } from "node:crypto";
import { getStripe } from "@/lib/stripe";

/**
 * Server-only adapter for the catalog objects a published plan sells.
 *
 * Every object is created **on the creator's connected account** (the
 * `Stripe-Account` request option), never on the Litesubs platform account.
 * That matches the direct-charge model: the creator owns the offer, the
 * customer pays the creator, and a published version records exactly which
 * Product/Price it committed to.
 *
 * Idempotency keys are derived from the plan version's stable row ID plus the
 * terms being provisioned, so a request that timed out after Stripe succeeded
 * is replayed instead of producing a second offer — while genuinely new terms
 * still get a new Price.
 */

export type PlanOfferInput = {
	stripeAccountId: string;
	/** Stable plan-version ID; the basis for Stripe idempotency keys. */
	versionId: string;
	name: string;
	description?: string | null;
	currency: string;
	/** Minor units of `currency`. */
	unitAmount: number;
	interval: "month" | null;
};

export type PlanOfferAdapter = {
	createProduct: (input: PlanOfferInput) => Promise<{ id: string }>;
	createPrice: (
		input: PlanOfferInput & { productId: string },
	) => Promise<{ id: string }>;
	deactivateProduct: (input: {
		stripeAccountId: string;
		productId: string;
	}) => Promise<void>;
	deactivatePrice: (input: {
		stripeAccountId: string;
		priceId: string;
	}) => Promise<void>;
};

export class StripeOfferError extends Error {
	constructor(
		public code: "STRIPE_UNAVAILABLE" | "STRIPE_REJECTED",
		message: string,
	) {
		super(message);
	}
}

function translate(error: unknown): StripeOfferError {
	if (error instanceof StripeOfferError) return error;
	if (typeof error === "object" && error !== null) {
		const record = error as { type?: string };
		if (record.type === "StripeInvalidRequestError")
			return new StripeOfferError(
				"STRIPE_REJECTED",
				"Stripe rejected this plan's terms",
			);
	}
	return new StripeOfferError(
		"STRIPE_UNAVAILABLE",
		"Stripe is temporarily unavailable",
	);
}

function stripeClient() {
	try {
		return getStripe();
	} catch {
		throw new StripeOfferError(
			"STRIPE_UNAVAILABLE",
			"Stripe is not configured",
		);
	}
}

/**
 * One product per plan version: renaming the service later must not spawn a
 * second Stripe product, and a lost response must not either.
 */
export function productIdempotencyKey(versionId: string) {
	return `litesubs:plan-version:${versionId}:product`;
}

/**
 * A price is bound to the terms it charges. Hashing them means a retried
 * attempt replays the same Price while edited terms produce a different key
 * instead of silently replaying the old amount.
 */
export function priceIdempotencyKey(
	input: Pick<
		PlanOfferInput,
		"versionId" | "currency" | "unitAmount" | "interval"
	> & {
		productId: string;
	},
) {
	const terms = [
		input.versionId,
		input.productId,
		input.currency.toLowerCase(),
		input.unitAmount,
		input.interval ?? "none",
	].join("|");
	const fingerprint = createHash("sha256")
		.update(terms)
		.digest("hex")
		.slice(0, 16);
	return `litesubs:plan-version:${input.versionId}:price:${fingerprint}`;
}

export const planOfferAdapter: PlanOfferAdapter = {
	async createProduct(input) {
		try {
			const stripe = stripeClient();
			const product = await stripe.products.create(
				{
					name: input.name,
					description: input.description || undefined,
					// Local metadata is correlation, never authorization.
					metadata: { planVersionId: input.versionId },
				},
				{
					stripeAccount: input.stripeAccountId,
					idempotencyKey: productIdempotencyKey(input.versionId),
				},
			);
			return { id: product.id };
		} catch (error) {
			throw translate(error);
		}
	},
	async createPrice(input) {
		try {
			const stripe = stripeClient();
			const price = await stripe.prices.create(
				{
					product: input.productId,
					currency: input.currency.toLowerCase(),
					unit_amount: input.unitAmount,
					...(input.interval
						? { recurring: { interval: input.interval } }
						: {}),
					metadata: { planVersionId: input.versionId },
				},
				{
					stripeAccount: input.stripeAccountId,
					idempotencyKey: priceIdempotencyKey(input),
				},
			);
			return { id: price.id };
		} catch (error) {
			throw translate(error);
		}
	},
	async deactivateProduct({ stripeAccountId, productId }) {
		try {
			const stripe = stripeClient();
			await stripe.products.update(
				productId,
				{ active: false },
				{ stripeAccount: stripeAccountId },
			);
		} catch (error) {
			throw translate(error);
		}
	},
	async deactivatePrice({ stripeAccountId, priceId }) {
		try {
			const stripe = stripeClient();
			await stripe.prices.update(
				priceId,
				{ active: false },
				{ stripeAccount: stripeAccountId },
			);
		} catch (error) {
			throw translate(error);
		}
	},
};

/**
 * Stripe refuses charges below a per-currency minimum. Publishing checks it up
 * front so a creator gets actionable feedback instead of a checkout that fails
 * for their first customer.
 *
 * Values are Stripe's documented minimum charge amounts, in minor units.
 */
export const STRIPE_MINIMUM_CHARGE: Record<string, number> = {
	usd: 50,
	eur: 50,
};

export function minimumChargeFor(currency: string) {
	return STRIPE_MINIMUM_CHARGE[currency.toLowerCase()] ?? null;
}
