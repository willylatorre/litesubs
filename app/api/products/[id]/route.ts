import { db } from '@/app/db'
import { products } from '@/app/db/schema'
import { auth } from '@/lib/auth'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth.api.getSession({
        headers: await headers(),
    })

    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Verify ownership
    const product = await db.query.products.findFirst({
        where: eq(products.id, id),
    })

    if (!product || product.creatorId !== session.user.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await req.json()
        const { active } = body
        
        if (typeof active !== 'boolean') {
             return NextResponse.json({ error: 'Invalid body, expected { active: boolean }' }, { status: 400 })
        }

        const [updatedProduct] = await db.update(products)
            .set({ active })
            .where(eq(products.id, id))
            .returning()
        
        return NextResponse.json(updatedProduct)
    } catch (err) {
        return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
    }
}
