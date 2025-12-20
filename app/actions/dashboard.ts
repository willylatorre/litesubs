'use server'

import { db } from '@/app/db'
import { transactions, products, userBalances } from '@/app/db/schema'
import { auth } from '@/lib/auth'
import { eq, and, count, sum, inArray } from 'drizzle-orm'
import { headers } from 'next/headers'

export async function getDashboardStats() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return {
      totalRevenue: 0,
      activeProducts: 0,
      totalCustomers: 0,
    }
  }

  const [revenueResult] = await db
    .select({ value: sum(products.price) })
    .from(transactions)
    .innerJoin(products, eq(transactions.productId, products.id))
    .where(
      and(
        eq(transactions.creatorId, session.user.id),
        eq(transactions.type, 'purchase')
      )
    )

  const [productsResult] = await db
    .select({ count: count() })
    .from(products)
    .where(
      and(
        eq(products.creatorId, session.user.id),
        eq(products.active, true)
      )
    )

  const [customersResult] = await db
    .select({ count: count() })
    .from(userBalances)
    .where(eq(userBalances.creatorId, session.user.id))

  return {
    totalRevenue: Number(revenueResult?.value || 0),
    activeProducts: Number(productsResult?.count || 0),
    totalCustomers: Number(customersResult?.count || 0),
  }
}

export async function getUserSubscriptions() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return []
  }

  const balances = await db.query.userBalances.findMany({
    where: eq(userBalances.userId, session.user.id),
    with: {
      creator: true,
    },
  })

  if (balances.length === 0) {
    return []
  }

  const creatorIds = balances.map((b) => b.creatorId)
  
  const creatorProducts = await db.query.products.findMany({
    where: and(
        inArray(products.creatorId, creatorIds),
        eq(products.active, true)
    )
  })

  return balances.map((balance) => ({
      ...balance,
      packs: creatorProducts.filter((p) => p.creatorId === balance.creatorId)
  }))
}
