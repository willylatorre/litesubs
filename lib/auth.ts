import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/app/db"; // your drizzle instance
import { stripe as baStripe } from "@better-auth/stripe"
import Stripe from "stripe"

import { tanstackStartCookies } from "better-auth/tanstack-start";
const stripeClient = new Stripe(process.env.STRIPE_SK_KEY!, {
    apiVersion: "2025-12-15.clover", // Latest API version as of Stripe SDK v20.0.0
})

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg", // or "mysql", "sqlite"
    }),
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        baStripe({
            stripeClient,
            stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
            createCustomerOnSignUp: true,
        }),
        tanstackStartCookies()] // make sure this is the last plugin in the array
});