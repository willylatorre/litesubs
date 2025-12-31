"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/app/db";
import { products, transactions } from "@/app/db/schema";
import { auth } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";

export async function createCheckoutSession(productId: string) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { error: "Unauthorized" };
	}

	const product = await db.query.products.findFirst({
		where: eq(products.id, productId),
	});

	if (!product) {
		return { error: "Product not found" };
	}

	const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

	// Use customer ID if available, otherwise email
	// Note: session.user might not have stripeCustomerId explicitly typed in all generic contexts
	// but better-auth usually returns the full user object fields.
	const customerId = (session.user as any).stripeCustomerId;

	const sessionParams: any = {
		line_items: [
			{
				price_data: {
					currency: product.currency,
					product_data: {
						name: product.name,
						description: product.description || undefined,
					},
					unit_amount: product.price, // in cents
				},
				quantity: 1,
			},
		],
		mode: "payment",
		success_url: `${appUrl}/dashboard?success=true&productId=${product.id}`,
		cancel_url: `${appUrl}/dashboard?canceled=true`,
		metadata: {
			userId: session.user.id,
			productId: product.id,
			credits: product.credits.toString(),
			creatorId: product.creatorId,
			type: "credit_purchase",
		},
	};

	if (customerId) {
		sessionParams.customer = customerId;
	} else {
		sessionParams.customer_email = session.user.email;
	}

	let checkoutSession;
	try {
		const stripe = getStripe();
		checkoutSession = await stripe.checkout.sessions.create(sessionParams);
	} catch {
		return { error: "Stripe is not configured" };
	}

	if (checkoutSession.id) {
		await db.insert(transactions).values({
			userId: session.user.id,
			creatorId: product.creatorId,
			productId: product.id,
			amount: product.credits,
			amountMoney: product.price,
			currency: product.currency,
			type: "purchase",
			description: `Purchase of ${product.credits} credits`,
			stripeCheckoutId: checkoutSession.id,
			status: "ongoing",
		});
	}

	if (checkoutSession.url) {
		redirect(checkoutSession.url);
	}
}

export async function createCustomerPortalSession() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { error: "Unauthorized" };
	}

	const customerId = (session.user as any).stripeCustomerId;

	if (!customerId) {
		return { error: "No billing account found" };
	}

	const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://litesubs.com";

	let portalSession;
	try {
		const stripe = getStripe();
		portalSession = await stripe.billingPortal.sessions.create({
			customer: customerId,
			return_url: `${appUrl}/dashboard/account`,
		});
	} catch {
		return { error: "Stripe is not configured" };
	}

	if (portalSession.url) {
		redirect(portalSession.url);
	}
}

export async function createPaymentLink(
	customerId: string,
	productId: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Unauthorized" };
	}

	// Fetch the product to ensure it belongs to the current creator
	const product = await db.query.products.findFirst({
		where: eq(products.id, productId),
	});

	if (!product) {
		return { success: false, error: "Product not found" };
	}

	if (product.creatorId !== session.user.id) {
		return { success: false, error: "Unauthorized" };
	}

	const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

	// Create a Stripe Price for this product (needed for payment links)
	const stripePrice = await stripe.prices.create({
		currency: product.currency,
		unit_amount: product.price,
		product_data: {
			name: product.name,
			metadata: {
				productId: product.id,
			},
		},
	});

	// Create the payment link with metadata matching the webhook expectations
	const paymentLink = await stripe.paymentLinks.create({
		line_items: [
			{
				price: stripePrice.id,
				quantity: 1,
			},
		],
		metadata: {
			userId: customerId,
			productId: product.id,
			credits: product.credits.toString(),
			creatorId: product.creatorId,
			type: "credit_purchase",
		},
		after_completion: {
			type: "redirect",
			redirect: {
				url: `${appUrl}/dashboard?success=true&productId=${product.id}`,
			},
		},
	});

	return { success: true, url: paymentLink.url };
}
