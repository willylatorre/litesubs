import { createAuthClient } from "better-auth/react"
import { stripeClient } from "@better-auth/stripe/client"

export const authClient = createAuthClient({
    plugins: [
        stripeClient({
            subscription: false //if you want to enable subscription management
        })
    ]
    /** The base URL of the server (optional if you're using the same domain) */
    // baseURL: "http://localhost:3000"
})