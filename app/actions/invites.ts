'use server'

import { db } from '@/app/db'
import { invites, userBalances } from '@/app/db/schema'
import { auth } from '@/lib/auth'
import { eq, and } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const createInviteSchema = z.object({
  email: z.string().email(),
})

export async function createInvite(prevState: any, formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { error: 'Unauthorized' }
  }

  const email = formData.get('email')
  const validated = createInviteSchema.safeParse({ email })

  if (!validated.success) {
    return { error: 'Invalid email' }
  }

  try {
    const existingInvite = await db.query.invites.findFirst({
        where: and(
            eq(invites.creatorId, session.user.id),
            eq(invites.email, validated.data.email),
            eq(invites.status, 'pending')
        )
    })

    if (existingInvite) {
        return { error: 'Pending invite already exists for this email.' }
    }

    const token = crypto.randomUUID()
    
    await db.insert(invites).values({
      creatorId: session.user.id,
      email: validated.data.email,
      token,
      status: 'pending',
    })

    revalidatePath('/dashboard/creator')
    return { success: true, message: 'Invite sent!' }
  } catch (error) {
    console.error("Failed to create invite:", error)
    return { error: 'Failed to create invite' }
  }
}

export async function getCreatorInvites() {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return []

    return await db.query.invites.findMany({
        where: eq(invites.creatorId, session.user.id),
        orderBy: (invites, { desc }) => [desc(invites.createdAt)],
    })
}

export async function getUserPendingInvites() {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return []

    return await db.query.invites.findMany({
        where: and(
            eq(invites.email, session.user.email),
            eq(invites.status, 'pending')
        ),
        with: {
            creator: true,
            product: true
        }
    })
}

export async function claimInvite(token: string) {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return { error: 'Unauthorized' }

    try {
        const invite = await db.query.invites.findFirst({
            where: and(
                eq(invites.token, token),
                eq(invites.status, 'pending')
            )
        })

        if (!invite) return { error: 'Invite not found' }

        // If invite has email, check if it matches
        if (invite.email && invite.email !== session.user.email) {
            return { error: 'This invite is for another user' }
        }

        await db.transaction(async (tx) => {
            // Update invite status and ensure email is set
            await tx.update(invites)
                .set({ 
                    email: session.user.email,
                    status: 'accepted' 
                })
                .where(eq(invites.id, invite.id))

            // Create user balance if not exists
            await tx.insert(userBalances)
                .values({
                    userId: session.user.id,
                    creatorId: invite.creatorId,
                    credits: 0
                })
                .onConflictDoNothing()
        })

        revalidatePath('/dashboard/subscriptions')
        revalidatePath('/dashboard')
        
        return { success: true }
    } catch (error) {
        console.error("Failed to claim invite:", error)
        return { error: 'Failed to claim invite' }
    }
}

export async function respondToInvite(inviteId: string, accept: boolean) {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return { error: 'Unauthorized' }

    try {
        const invite = await db.query.invites.findFirst({
            where: and(
                eq(invites.id, inviteId),
                eq(invites.email, session.user.email),
                eq(invites.status, 'pending')
            )
        })

        if (!invite) {
            return { error: 'Invite not found or invalid' }
        }

        await db.transaction(async (tx) => {
             // Update invite status
             await tx.update(invites)
                 .set({ status: accept ? 'accepted' : 'rejected' })
                 .where(eq(invites.id, inviteId))

             if (accept) {
                 // Create user balance if not exists
                 await tx.insert(userBalances)
                     .values({
                         userId: session.user.id,
                         creatorId: invite.creatorId,
                         credits: 0
                     })
                     .onConflictDoNothing()
             }
        })

        revalidatePath('/dashboard/subscriptions')
        revalidatePath('/dashboard')
        return { success: true }
    } catch (error) {
        console.error("Failed to respond to invite:", error)
        return { error: 'Failed to process request' }
    }
}
