import { db } from '@/app/db'
import { transactions, userBalances } from '@/app/db/schema'
import { stripe } from '@/lib/stripe'
import { sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export async function POST(req: NextRequest) {
    const body = await req.text()
    const signature = (await headers()).get('stripe-signature') as string

    let event: Stripe.Event

    try {
        event = stripe.webhooks.constructEvent(
            body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET!
        )
    } catch (err: any) {
        console.error(`Webhook signature verification failed: ${err.message}`)
        return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 })
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session
        
        const userId = session.metadata?.userId
        const productId = session.metadata?.productId
        const credits = parseInt(session.metadata?.credits || '0')
        const creatorId = session.metadata?.creatorId
        const type = session.metadata?.type

        if (userId && creatorId && credits > 0 && type === 'credit_purchase') {
            try {
                await db.transaction(async (tx) => {
                    // 1. Update User Balance (Upsert)
                    await tx.insert(userBalances)
                        .values({
                            userId,
                            creatorId,
                            credits,
                        })
                        .onConflictDoUpdate({
                            target: [userBalances.userId, userBalances.creatorId],
                            set: {
                                credits: sql`${userBalances.credits} + ${credits}`,
                                updatedAt: new Date(),
                            }
                        })

                    // 2. Create Transaction Record
                    await tx.insert(transactions).values({
                        userId,
                        creatorId,
                        productId: productId || null,
                        amount: credits,
                        type: 'purchase',
                        description: `Purchased via Stripe Session ${session.id}`,
                    })
                })
                console.log(`Processed purchase for user ${userId} / creator ${creatorId}: +${credits} credits`)
            } catch (error) {
                console.error('Error processing webhook transaction:', error)
                return new NextResponse('Database Error', { status: 500 })
            }
        }
    }

    return new NextResponse(null, { status: 200 })
}
