import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/app/db"; // your drizzle instance
import { stripe as baStripe } from "@better-auth/stripe"
import { stripe } from "@/lib/stripe"
import { nextCookies } from 'better-auth/next-js'

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg", // or "mysql", "sqlite"
    }),
    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        baStripe({
            stripeClient: stripe,
            stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
            createCustomerOnSignUp: true,
        }),
        nextCookies()] // make sure this is the last plugin in the array
});