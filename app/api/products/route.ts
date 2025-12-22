import { db } from '@/app/db'
import { products } from '@/app/db/schema'
import { auth } from '@/lib/auth'
import { eq, desc } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const createProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  price: z.number().min(0, "Price must be positive"),
  credits: z.number().int().min(1, "Credits must be at least 1"),
  currency: z.enum(['usd', 'eur']).default('usd'),
})

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userProducts = await db.query.products.findMany({
    where: eq(products.creatorId, session.user.id),
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  })

  return NextResponse.json(userProducts)
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    const validated = createProductSchema.safeParse(body)

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid input", fieldErrors: validated.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, description, price, credits, currency } = validated.data

    const [product] = await db
      .insert(products)
      .values({
        creatorId: session.user.id,
        name,
        description,
        price: Math.round(price * 100), // Convert to cents
        credits,
        currency,
      })
      .returning()

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    console.error("Failed to create product:", error)
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 }
    )
  }
}
