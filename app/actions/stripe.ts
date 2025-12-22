"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/app/db";
import { products } from "@/app/db/schema";
import { auth } from "@/lib/auth";
import { stripe } from "@/lib/stripe";

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

	const checkoutSession = await stripe.checkout.sessions.create(sessionParams);

	if (checkoutSession.url) {
		redirect(checkoutSession.url);
	}
}
