# React Performance Improvements - Prioritized List

Based on analysis using the `react-best-practices` skill from Vercel Engineering, here are 10 prioritized improvements for the liteSubs codebase.

---

## 🔴 CRITICAL (Priority 1-2)

### 1. Parallelize `getCreatorStats` Sequential Database Queries

**File:** `app/actions/dashboard.ts` (lines 101-142)

**Issue:** Three sequential database queries create a waterfall pattern, adding full network/query latency for each operation.

**Current Code:**
```typescript
const [revenueResult] = await db.select(...)  // Query 1 - waits
const [productsResult] = await db.select(...) // Query 2 - waits for Query 1
const [customersResult] = await db.select(...) // Query 3 - waits for Query 2
```

**Fix:** Use `Promise.all()` for independent operations:
```typescript
const [revenueResult, productsResult, customersResult] = await Promise.all([
  db.select({ value: sum(transactions.amountMoney) }).from(transactions)...,
  db.select({ count: count() }).from(products)...,
  db.select({ count: countDistinct(liteSubscriptions.userId) }).from(liteSubscriptions)...,
])
```

**Impact:** ~3x faster response time for this endpoint.

---

### 2. Parallelize `getCustomerDetails` Sequential Fetches

**File:** `app/actions/customers.ts` (lines 62-112)

**Issue:** Four sequential database operations where `customer`, `subscriptions`, `spentResult`, and `transactions` could run in parallel.

**Current Code:**
```typescript
const customer = await db.query.user.findFirst(...)
const subscriptions = await db.query.liteSubscriptions.findMany(...)
const [spentResult] = await db.select(...)
const customerTransactions = await db.query.transactions.findMany(...)
```

**Fix:** Parallelize independent queries with `Promise.all()`:
```typescript
const [customer, subscriptions, [spentResult], customerTransactions] = await Promise.all([
  db.query.user.findFirst(...),
  db.query.liteSubscriptions.findMany(...),
  db.select({ value: sum(transactions.amountMoney) })...,
  db.query.transactions.findMany(...),
])
```

**Impact:** ~4x faster customer details loading.

---

### 3. Parallelize `createCheckoutSession` Sequential Operations

**File:** `app/actions/stripe.ts` (lines 13-118)

**Issue:** Sequential fetches for session, product, and connect account when they could be started in parallel.

**Current Code:**
```typescript
const session = await auth.api.getSession(...)  // Blocks
const product = await db.query.products.findFirst(...)  // Waits for session
const connectAccount = await getCreatorConnectAccount(product.creatorId) // Waits for product
```

**Fix:** Start independent operations early:
```typescript
const sessionPromise = auth.api.getSession({ headers: await headers() })
const productPromise = db.query.products.findFirst({ where: eq(products.id, productId) })

const session = await sessionPromise
if (!session?.user) return { error: "Unauthorized" }

const product = await productPromise
if (!product) return { error: "Product not found" }

const connectAccount = await getCreatorConnectAccount(product.creatorId)
```

**Impact:** Faster checkout initiation, better user experience.

---

## 🟠 HIGH (Priority 3)

### 4. Add `React.cache()` for Per-Request Auth Deduplication

**Files:** `lib/safe-action.ts`, `app/dashboard/payouts/page.tsx`

**Issue:** Pages like `payouts/page.tsx` call 3-6 server actions in the same request, each invoking `authenticatedAction` which calls auth separately.

**Example of redundant calls (same request):**
```typescript
// payouts/page.tsx - auth is called 3+ times in one request!
await syncPayoutAccountStatus()           // auth call #1
const connectAccountRes = await getConnectAccountStatus()  // auth call #2  
const [balanceRes, accountRes, historyRes] = await Promise.all([
  getAccountBalance(),   // auth call #3
  getPayoutAccount(),    // auth call #4
  getPayoutHistory(),    // auth call #5
])
```

**Fix:** Create cached auth helper:
```typescript
// lib/auth-cached.ts
import { cache } from 'react'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

export const getCurrentSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() })
})
```

Then use `getCurrentSession()` in `authenticatedAction` instead of direct auth call.

**⚠️ Safety Note:** `React.cache()` is **per-request only** - it does NOT cache across requests:
- Each HTTP request gets a fresh cache
- Logout = new request = fresh auth state (returns null)
- Login = new request = fresh auth state (returns session)
- This is NOT like LRU caching that persists data

**Impact:** Eliminates 3-5 redundant auth calls per page load on pages with multiple server actions.

---

### 5. Minimize Serialization at RSC Boundaries

**Files:** `app/dashboard/page.tsx`, `app/dashboard/creator/page.tsx`

**Issue:** Entire data objects are passed to client components when only specific fields are used.

**Current Code:**
```tsx
// Passes entire `data` object with all subscriptions and their nested relations
<DashboardClient initialData={data} />
```

**Fix:** Extract only required fields before passing to client:
```tsx
const clientData = {
  stats: data.stats,
  subscriptions: data.subscriptions.map(s => ({
    id: s.id,
    credits: s.credits,
    product: { id: s.product.id, name: s.product.name, price: s.product.price },
    creator: s.creator ? { name: s.creator.name } : null,
  })),
  pendingInvites: data.pendingInvites.map(i => ({ /* only needed fields */ })),
}
<DashboardClient initialData={clientData} />
```

**Impact:** Smaller payload size, faster hydration.

---

## 🟡 MEDIUM (Priority 4-6)

### 6. Defer `useSearchParams` Reads to Usage Point

**File:** `app/dashboard/dashboard-client.tsx` (lines 25-43)

**Issue:** Component subscribes to `searchParams` changes and re-renders on every URL change, even though values are only read inside the `useEffect`.

**Current Code:**
```tsx
const searchParams = useSearchParams()  // Subscribes to ALL searchParams changes
const success = searchParams.get("success")
const purchasedProductId = searchParams.get("productId")

useEffect(() => {
  if (success && purchasedProductId) {
    // ...
  }
}, [success, purchasedProductId, searchParams, onSuccess])
```

**Fix:** Read params on-demand inside effect:
```tsx
useEffect(() => {
  const params = new URLSearchParams(window.location.search)
  const success = params.get("success")
  const purchasedProductId = params.get("productId")
  
  if (success && purchasedProductId) {
    // handle success...
  }
}, []) // Only run once on mount
```

**Impact:** Eliminates unnecessary re-renders on URL changes.

---

### 7. Use React Query/SWR for Dialog Data Fetching

**File:** `app/dashboard/packs/pack-details-dialog.tsx` (lines 42-53)

**Issue:** Manual `useEffect` + `useState` for data fetching without caching or deduplication.

**Current Code:**
```tsx
useEffect(() => {
  if (open) {
    setLoading(true)
    getPackDetails(packId).then(res => {
      if (res.success) setDetails(res.data)
    }).finally(() => setLoading(false))
  }
}, [open, packId])
```

**Fix:** Use React Query with caching:
```tsx
const { data: details, isLoading } = useQuery({
  queryKey: ['pack-details', packId],
  queryFn: () => getPackDetails(packId).then(res => res.data),
  enabled: open, // Only fetch when dialog opens
  staleTime: 30000, // Cache for 30 seconds
})
```

**Impact:** Automatic caching, deduplication, and better loading states.

---

### 8. Narrow Effect Dependencies in `useTransactionCheck`

**File:** `hooks/use-transaction-check.ts` (lines 19-75)

**Issue:** Effect depends on the entire `searchParams` object, causing re-runs when unrelated params change.

**Current Code:**
```tsx
useEffect(() => {
  // ...
}, [success, purchasedProductId, searchParams, onSuccess])
```

**Fix:** Remove searchParams from dependencies (use primitives only):
```tsx
useEffect(() => {
  // ... (use local variable reads)
}, [success, purchasedProductId])
```

Or use the pattern from improvement #6 to read params on-demand.

**Impact:** Prevents unnecessary effect re-runs.

---

### 9. Use `startTransition` for Polling Updates

**File:** `hooks/use-transaction-check.ts` (line 41-45)

**Issue:** Polling state updates may block UI responsiveness.

**Current Code:**
```tsx
const result = await checkTransactionStatus(purchasedProductId)
if (result?.status === "completed") {
  if (onSuccess) await onSuccess()  // May trigger state updates
}
```

**Fix:** Wrap non-urgent updates in transitions:
```tsx
import { startTransition } from 'react'

if (result?.status === "completed") {
  startTransition(() => {
    if (onSuccess) onSuccess()
  })
}
```

**Impact:** Maintains UI responsiveness during polling.

---

### 10. Add Strategic Suspense Boundaries for Streaming

**File:** `app/dashboard/creator/page.tsx`

**Issue:** Entire page waits for `getCreatorStats()` before rendering, blocking static UI elements.

**Current Code:**
```tsx
export default async function CreatorDashboardPage() {
  const stats = await getCreatorStats()  // Blocks entire page
  return (
    <div>
      <h1>Creator Dashboard</h1>  {/* Could render immediately */}
      <SectionCards {...stats} />
      <LivePacks />
      <RecentInvites />
    </div>
  )
}
```

**Fix:** Use Suspense to stream content:
```tsx
export default function CreatorDashboardPage() {
  return (
    <div>
      <h1>Creator Dashboard</h1>  {/* Renders immediately */}
      <Suspense fallback={<SectionCardsSkeleton />}>
        <SectionCardsWithData />
      </Suspense>
      <LivePacks />
      <RecentInvites />
    </div>
  )
}

async function SectionCardsWithData() {
  const stats = await getCreatorStats()
  return <SectionCards {...stats} />
}
```

**Impact:** Faster Time to First Byte (TTFB), better perceived performance.

---

## Summary

| # | Issue | Category | Impact |
|---|-------|----------|--------|
| 1 | Sequential DB queries in `getCreatorStats` | Eliminating Waterfalls | CRITICAL |
| 2 | Sequential DB queries in `getCustomerDetails` | Eliminating Waterfalls | CRITICAL |
| 3 | Sequential fetches in `createCheckoutSession` | Eliminating Waterfalls | CRITICAL |
| 4 | Missing `React.cache()` for auth dedup | Server-Side Performance | HIGH |
| 5 | Over-serialization at RSC boundaries | Server-Side Performance | HIGH |
| 6 | `useSearchParams` subscription causing re-renders | Re-render Optimization | MEDIUM |
| 7 | Manual fetch in dialogs instead of React Query | Client-Side Data Fetching | MEDIUM |
| 8 | Object dependencies in useEffect | Re-render Optimization | MEDIUM |
| 9 | Missing `startTransition` for polling | Re-render Optimization | MEDIUM |
| 10 | Missing Suspense boundaries | Server-Side Performance | MEDIUM |

---

## References

- [React Best Practices Skill](/workspace/skills/react-best-practices/SKILL.md)
- [React Performance Guidelines](/workspace/skills/react-best-practices/references/react-performance-guidelines.md)
