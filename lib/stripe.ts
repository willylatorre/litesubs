import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

/**
 * Lazily initialize Stripe.
 *
 * Important: don't create the client at module load time, because Next.js will
 * import server modules during build (route analysis / page data collection).
 */
export function getStripe() {
	if (stripeSingleton) return stripeSingleton;

	const apiKey = process.env.STRIPE_SECRET_KEY;
	if (!apiKey) {
		throw new Error("STRIPE_SECRET_KEY is not set");
	}

	stripeSingleton = new Stripe(apiKey, {
		apiVersion: "2025-12-15.preview",
		typescript: true,
	});

	return stripeSingleton;
}
