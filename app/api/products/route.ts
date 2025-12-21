import { db } from '@/app/db'
import { products } from '@/app/db/schema'
import { auth } from '@/lib/auth'
import { eq, desc } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createProductSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  price: z.coerce.number().min(0, 'Price must be positive'),
  credits: z.coerce.number().int().min(1, 'Credits must be at least 1'),
})

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const data = await db.query.products.findMany({
    where: eq(products.creatorId, session.user.id),
    orderBy: [desc(products.createdAt)],
  })

  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
      const body = await req.json()
      const validated = createProductSchema.safeParse(body)

      if (!validated.success) {
        return NextResponse.json({ 
          error: 'Validation failed', 
          fieldErrors: validated.error.flatten().fieldErrors 
        }, { status: 400 })
      }

      const { name, description, price, credits } = validated.data

      const [newProduct] = await db.insert(products).values({
        creatorId: session.user.id,
        name,
        description: description || '',
        price: Math.round(price * 100), // Convert to cents
        credits,
        type: 'one_time',
        active: true,
      }).returning()

      return NextResponse.json(newProduct, { status: 201 })
  } catch (error) {
    console.error('Failed to create product:', error)
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}
