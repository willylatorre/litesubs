# Security & Correctness Remediation Plan

Status of the audit findings from the dependency-upgrade session. Ordered by
blast radius: money movement first, then auth/security surface, then hygiene.

Dependency state: `next 16.4.6`, `better-auth 1.7.21`, `stripe 23.1.0`
(already the latest published), `drizzle-orm 0.45.4`, `zod 4.6.7`.
`npm audit`: 0 critical, 0 high. No further version bump is required.

---

## P0 — Money movement is broken or unsafe

### 1. `NEXT_PUBLIC_APP_URL` missing fallbacks — DONE
`app/actions/payouts.ts` and `stripe-connect.ts` interpolated a bare
`process.env.NEXT_PUBLIC_APP_URL`, producing `undefined/dashboard/payouts` in
Stripe `return_url`/`refresh_url`. Onboarding dead-ended with no error.

Fix: new `lib/app-url.ts` (`getAppUrl()` / `appUrl()`), used by payouts,
stripe-connect and stripe actions. Never returns `undefined`; env → localhost in
dev → `https://litesubs.com`.

### 2. Stripe Connect v1/v2 mismatch — DONE
`setupPayoutAccount` creates the recipient with v2 `v2.core.accounts.create`,
but `syncPayoutAccountStatus` retrieved it with v1 `stripe.accounts.retrieve`.
A `v2` account ID on a v1 endpoint fails, so verification never completed.

Fix: retrieve via `stripe.v2.core.accounts.retrieve` and derive status from the
recipient `bank_accounts` capability plus `requirements.summary.minimum_deadline`
instead of v1 `payouts_enabled`/`charges_enabled`/`details_submitted`.

### 3. Payout webhook listens on the wrong (v1) event family
Payouts are dispatched through v2 `v2.moneyManagement.outboundPayments.create`
and stored with the **outbound payment ID**, but
`app/api/webhooks/stripe/route.ts` matches only v1 `payout.paid` /
`payout.failed` / `payout.canceled` by `payout.id`.

Consequences: payouts never leave `processing`, and a failed payout never
restores the creator's balance.

Fix: handle `v2.money_management.outbound_payment.posted`,
`.failed`, `.canceled` and `.returned`, matching on the outbound payment ID.
Map `posted → completed`, `failed/returned → failed`, `canceled → cancelled`.
Restore balance on the failure paths exactly as the v1 handler did.

### 4. `requestPayout` never validates input
`requestPayoutSchema` is declared but `safeParse` is never called, so the raw
`input.amount` reaches `Math.round(amount * 100)` and Stripe unchecked.

Fix: `safeParse` at the top of the action and return `fieldErrors` on failure.
Also reject non-finite / non-positive / more-than-2dp amounts.

### 5. Payout double-spend race
The pending-payout check and the insert share one `db.transaction` at the
default READ COMMITTED isolation, so two concurrent requests can both observe
"no pending payout" and each dispatch an outbound payment.

Fix: run the balance check + insert at `isolationLevel: "serializable"` and
re-check for an existing pending payout inside that transaction.

### 6. `createCheckoutSession` ignores `product.active`
Deactivated plans stay purchasable by ID.

Fix: return an error when `!product.active`.

---

## P1 — Auth & webhook security

### 7. Cal.com integration — deferred / not ready
Per product direction, Cal.com is not a supported/ready integration yet. Do not
implement booking fulfillment or enable this webhook. The route remains a
fail-closed placeholder; signature verification is not a release requirement
until the integration is deliberately brought back into scope.

### 8. Production trusts development origins
`lib/auth.ts` `trustedOrigins` ships a Codespaces URL and a Cloud Workstations
URL; `next.config.ts` allows the wildcard `*.app.github.dev` as a Server Action
origin.

Fix: keep `litesubs.com` + localhost always; include dev origins only when
`NODE_ENV !== "production"`. Replace the wildcard with explicit dev entries.

### 9. `getCalAccountStatus` leaks OAuth tokens
The exported `"use server"` action returns the whole `calComAccounts` row,
including `accessToken`/`refreshToken`.

Fix: return only non-secret fields (`calUsername`, `calUserId`, `expiresAt`,
`scope`, `connected`).

### 10. Credit adjustments can go negative
`updateSubscriptionCredits` / `updateCustomerCredits` apply `credits + amount`
with only a client-side guard.

Fix: clamp at zero server-side, and reject adjustments that would exceed the
current balance downward.

---

## P2 — Hardening & hygiene

### 11. Invite links never expire and leak the invitee email
An unbound invite is claimable forever by anyone with the URL; the invite page
renders `invite.email` to any visitor.

Fix: add `expiresAt` (default +14 days), enforce it in `claimInvite` and
`respondToInvite`, and only render the invitee email to the signed-in user it
belongs to.

### 12. Dead `signup()` server action
`app/actions/auth.ts` calls `authClient.signUp.email()` without awaiting or
checking the result and is imported nowhere.

Fix: delete the file.

### 13. No CI gate
CI only runs Drizzle migrations; nothing typechecks or builds, on a codebase
that moves money.

Fix: add a workflow running `npm ci`, `tsc --noEmit`, `next build` and
`npm audit --audit-level=high`.

### 14. No tests
Zero test coverage.

Fix: add focused tests for the pure logic (balance calculation, payout amount
validation, webhook status mapping). Not a blocker, but the payout math is the
highest-value target.

---

## Verification for every step
`npx tsc --noEmit` clean, `npm run build` success, and a runtime smoke test
(`/`, `/auth/sign-in` → 200, `/dashboard` → 307 to sign-in, `/api/products` → 401).
