# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-01-01

### Changed
- **Create-plan dialog**: the terms section had three unrelated vertical rhythms —
  a `py-4` wrapper, ad-hoc gaps, and a footer flush against the last field — so
  price, credits, and the submit button shared no baseline. Field spacing is now
  uniform and the footer is separated by a rule, with Cancel beside Create Draft
  instead of a lone right-aligned button. Credits gained the subtitle the page
  could not otherwise convey ("Lessons, products, items, etc."), the derived rate
  sits under the field that produces it ("That works out to $10.00 per credit"),
  and a live summary states the offer in the customer's terms ("Your customer will
  pay $100.00 for 10 credits"). Price, currency, and credits are now controlled
  state, so both readouts follow the currency, the billing mode, and the
  singular/plural of the count; the form resets on close so a created draft no
  longer leaves stale values behind. The dialog also scrolls on short viewports,
  where the footer previously fell off-screen.
- **Username-based public links**: schedules now live at
  `/book/<username>/<slug>`, invites at `/invite/<username>/<token>`, and payment
  requests at `/pay/<username>/<token>`. Better Auth manages unique, permanent
  usernames; new email signups choose one, and existing or Google users can choose
  one under Account instead of having one derived from their email. Legacy links
  keep working and redirect to the canonical username URL once available. Invite
  and payment tokens remain opaque and single-use. Migration `0017` adds a
  nullable unique username without changing existing users or commercial data.
- **Sidebar grouping**: reordered by the creator's loop rather than page type —
  "My Account", then "Creator" (Dashboard, Plans, Customers, Bookings, Payments,
  Integrations), then "Developer" (API Tokens, Webhooks). Customers now sits
  directly under Plans, and Integrations moved below the money-related pages.
- **Active nav state**: nav items never passed `isActive`, so the sidebar could
  not show which page you were on. Every item now reflects the current route with
  exactly one active, including `aria-current="page"`. A container route like
  `/dashboard` matches exactly, so it no longer lights on every child page.
- **Webhooks** was reachable only by typing the URL; it is now in the sidebar.
- `/dashboard/developers` redirected to the public `/docs`, which rendered the
  identical component in two places and could drift. `/docs` is the single copy.
- Fixed the light-mode `--sidebar-accent` token: it was oklch(0.98) against a
  0.99 sidebar, so hover and the selected row were effectively invisible.

### Removed
- **Cal.com integration**: the vendor card, OAuth routes, inbound webhook, event-type
  pickers, and the `integrations` / `calcom_integrations` / `cal_com_accounts`
  tables. Native booking schedules are the only booking path now, so the vendor
  tables were a parallel unusable route. Migration `0016` drops them; it does not
  touch plans, prices, enrollments, credits, bookings, or payments, which never
  held a foreign key into them.

### Added
- **Invite a customer from the Customers page**: the link generator previously
  existed only on the Creator dashboard and the plan views, so the page that
  lists customers had no way to add one — its empty state told you to "invite a
  customer" and gave you nothing to click. `Add customer` now opens the same
  email + plan form there, and a new pending-invites card lists links that have
  not been claimed yet with copy and share controls. Without that card a creator
  who closed the dialog lost the only copy of the URL and the invite silently
  expired.
- **Native sharing**: invite links now offer `navigator.share` (the phone share
  sheet) next to copy, via `lib/share-link.ts`. A dismissed sheet is treated as a
  decision and never copies behind the user's back; a browser without a sheet
  falls back to the clipboard.
- **Re-requesting a pending invite returns the live link** instead of `409
  INVITE_EXISTS`. Same email and same offer yields the existing token; different
  plan terms still conflict, because the recipient may already hold the old link.
- `GET /api/v1/invites` now returns a share `url` per invite — canonical
  `/invite/<username>/<token>` once a username exists, legacy `/invite/<token>`
  before that — so every surface shares the same path and older pending invites
  do not vanish from the list. In the browser the URL is re-hosted on the current
  origin: a preview deployment must not hand out production links to records that
  only exist in the preview database.
- The single-use Checkout link dialog uses the same copy/share control instead of
  its own clipboard-only button. Stripe URLs are shared exactly as issued.
- **Native bookings**:
  - Creators define weekly availability, buffers, a horizon, a timezone, and
    one-off blocks; a schedule links to a one-time plan and a booked slot spends
    that plan's credits. See `docs/BOOKINGS.md`.
  - Public booking pages include the creator username: slugs are unique per
    creator, so addressing by slug alone would serve the wrong schedule.
  - Slot math is pure and timezone-tested: availability is wall-clock in the
    schedule's zone, bookings are UTC instants, and DST gaps are detected rather
    than silently shifted.
  - Double-booking is prevented by a `btree_gist` exclusion constraint, not a
    read-then-insert check. Cancelling restores only the units the booking took,
    back to the grants they came from, so book/cancel cannot mint credits.
  - Customers can see and cancel their bookings from the dashboard. That view was
    missing at first, which left the restore path unreachable for the person it
    protects.
- **In-app notifications**: booking confirmations and cancellations notify both
  parties, deduped in the database, with "starting soon" derived on read so no
  scheduler is needed. No email is sent.
- **Google Calendar (optional)**: OAuth connection with AES-256-GCM encrypted
  tokens, free/busy slot filtering, and best-effort event sync that cannot roll
  back a booking or a debit. Unverified against a live Google client.
- **Outgoing webhooks**:
  - Creators register HTTPS endpoints for `purchase.completed` and
    `credits.changed`. Deliveries are signed with HMAC-SHA256 over the exact
    body, carry a stable event id the receiver dedupes on, and are stored before
    sending so a retry re-sends the same bytes rather than re-deriving history.
  - Emitted after the ledger transaction commits, so a receiver failure can never
    roll back a paid grant or a debit, and a replayed ledger event does not emit
    twice.
  - Configuration requires a dedicated `webhooks:manage` scope: it is a
    data-egress permission, so it is not folded into `plans:write` and can never
    be held by a machine API key. Signing secrets are returned once and never by
    any read path.
  - Failures are visible and retryable from the dashboard or
    `POST /api/v1/deliveries/:id/retry`. No scheduler is involved.
- **Error and not-found boundaries**:
  - Added `app/global-error.tsx`, `app/error.tsx`, `app/dashboard/error.tsx`, and
    `app/not-found.tsx`. Previously no boundary existed, so Next generated a bare
    document for `/_global-error` and every 404 fell back to a generic page.
  - Boundaries show the error digest for log correlation, state explicitly that
    nothing was charged or changed, and offer `retry()` plus a safe way out.
  - The not-found page names the two realistic causes (expired invite/token, plan
    no longer available) instead of a generic message.
- **Subscription-aware disconnect (S15)**:
  - Disconnecting a Stripe account now enumerates the creator's live
    subscriptions from Litesubs' own records and refuses to complete silently
    while any remain unhandled.
  - The Payments screen reports how many subscriptions can still renew and asks
    for an explicit choice: stop renewals at each paid period, or keep the
    connection until they end.
  - Stopping renewals reuses the customer cancel path with `creator_disconnect`
    recorded as the cause, so a platform-driven stop is never read as the
    customer's own cancellation.
  - Access and granted credits still run to the paid-period end; a renewal Stripe
    still collects without a disconnect-safe cancellation moves money without
    granting credits or extending the paid-through boundary.
  - The deauthorization webhook applies the same handling, and a Stripe failure
    leaves a visible, retryable state instead of a false success. Customers see
    the honest ending state rather than a renewal date that will not be honoured.
- **Receipt-based reporting (S13)**:
  - Creator and customer money summaries now come from confirmed payments and
    subscription invoices, grouped per currency with gross, refunded, net, and
    platform fees. USD and EUR are never blended into one total.
  - Pending Checkouts, comps, and manual grants no longer inflate sales.
  - Plan and customer detail views show money and credits as separate concepts.
- **Refund reconciliation (S12)**:
  - Reconcile `charge.refunded` against the owning account's receipt and revoke
    only the unspent units attributable to that purchase.
  - Keep partial refunds financial-only (`requiresAdjustment`) and never cancel a
    subscription because one of its invoices was refunded.
  - Block the fulfillment path after a refund that arrives before the purchase is
    granted, so refunded money can never become spendable credits.
- **Invites and credit expiry (S11)**:
  - Invites pin the published version they offered; claiming after a re-price
    fails loudly instead of silently granting the new terms.
  - Complimentary and manual grants record an expiry: one-time plans keep credits,
    while monthly plans inherit the current paid period and require an explicit
    future date when no period is paid.
  - Invite and enrollment views show the granted units and expiry before claiming.
- **Customer billing portal (S10)**:
  - Provision a marked platform portal configuration with payment-method and
    invoice-history features, while disabling subscription plan changes/cancel.
  - Create short-lived sessions against each customer's mapped Stripe Customer
    on the subscription's owning connected account; URLs are not persisted.
- **Subscription cancellation (S09)**:
  - Allow authenticated customers to cancel renewals at the paid-period end and
    resume before cancellation takes effect.
  - Mirror connected-account Stripe lifecycle changes without changing paid
    credit expiry; a later purchase starts a new subscription identity.
- **Monthly renewals (S08)**:
  - Fulfill each eligible paid cycle invoice against the original plan version,
    with one expiring allowance per service period.
  - Record failed invoices as overdue without extending paid-through or granting
    credits; successful retries and out-of-order events remain idempotent.
  - Return usable grant balances and overdue billing state in customer summaries.
- **Monthly subscriptions (S07 first-period slice)**:
  - Added creator-account monthly Checkout with a persisted 2% recurring fee rate.
  - Fulfill the first monthly allowance only from the verified, account-scoped
    paid invoice; grants expire at the subscription line's paid-period end.
  - Keep duplicate/concurrent starts and invoice delivery idempotent. Monthly
    Checkout remains test-mode only until the live-release gate is complete.
- **Landing Page & SEO**:
  - Improved the landing page with a minimalist 3-step "How it works" demo.
  - Added comprehensive metadata (OpenGraph/Twitter/Canonical) and JSON-LD structured data.
  - Added `app/robots.ts` and `app/sitemap.ts` for better indexing.
- **Payment Links**:
  - Added Stripe payment link generation for a specific customer + pack from the Customer details subscription row.
- **Payouts**:
  - Implemented the payouts flow with balance/earnings history and a dedicated `app/dashboard/payouts` page.
- **Help & FAQ**:
  - Added a dedicated dashboard FAQ page at `app/dashboard/faq`.

## [Unreleased] - 2025-12-29

### Added
- **Account Management**:
  - Integrated `better-auth-ui` for user profile and security settings.
  - Created a new dashboard-integrated account section at `app/dashboard/account/[path]`.
  - Added a "Billing History" placeholder page at `app/dashboard/account/billing`.
  - Updated `NavUser` component to provide direct links to "Account" and "Billing" settings.
  - Harmonized account page styling with the rest of the dashboard layout.

## [Unreleased] - 2025-12-23

### Added
- **Detailed Plan & Ledger System**:
  - Created `app/dashboard/subscriptions/[subscriptionId]/page.tsx` for customers to view credits and usage history for specific plans.
  - Implemented a "Transaction Ledger" table showing all credit changes (purchases, adjustments).
  - Added "Top up" functionality directly from the plan detail view.
- **Enhanced Creator Management**:
  - Created `CustomerDetailsDialog` to manage individual customers via a minimalist modal.
  - Display "Total Spent" for each customer based on their purchase history.
  - Integrated **React Query** into the customer details modal for progressive loading (Skeletons) and instant updates.
  - Added `PackDetailsDialog` to the Packs page, showing pack stats and a list of current subscribers.
  - Implemented quick credit adjustment: added a "-1 Credit" button for rapid balance management.
- **Data Fetching & API**:
  - Added `getCustomerDetails` and `getPackDetails` server actions to fetch detailed relationship data.
  - Updated `getCreatorCustomers` to include per-customer pack subscriptions and individual credit balances.
  - Added `getUserTransactions` and `getCreatorCustomerTransactions` for ledger data.

### Changed
- **Invite Flow Polish**:
  - Refactored `app/invite/[token]` to use a manual "Accept Invite" button, resolving a `revalidatePath` rendering error.
  - Improved invite status handling: users are now informed if an invite has already been claimed or has expired.
- **UI/UX Improvements**:
  - Redesigned the customer and pack details views to be more minimalistic, removing unnecessary borders and simplifying typography.
  - Harmonized button sizes across the dashboard for better visual consistency.
  - Replaced the standalone `/dashboard/customers/[customerId]` page with the more efficient `CustomerDetailsDialog` modal.
- **Buy Button**:
  - Updated `BuyButton` to support `fullWidth` prop for better layout flexibility in headers.

### Fixed
- Resolved "Route /invite/[token] used 'revalidatePath' during render" error by moving side effects to client-side actions.
- Fixed a syntax error in `app/actions/products.ts` caused by nested export declarations.

## [Unreleased] - 2025-12-22

### Added
- **Currency Selection**:
  - Added support for multiple currencies (USD, EUR) when creating packs.
  - Updated database schema, API, and UI to store and display currency-specific prices.
  - Integrated currency support into the Stripe Checkout flow.
- **Invite System Overhaul**:
  - Implemented generic invite links (email optional) for broader sharing.
  - Added `app/invite/[token]/page.tsx` to handle invite acceptance and display linked products.
  - Added `claimInvite` server action to associate generic invites with the current user and auto-accept them.
  - Added "Generate Invite Link" action to `PackActions`, creating a unique link pre-filled with the selected pack.
  - Updated `app/dashboard/subscriptions/page.tsx` to show pending product invites and a low-credit alert (< 2 credits).
- **Authentication Improvements**:
  - Added `middleware.ts` to protect `/dashboard` routes and redirect unauthenticated users to `/auth/sign-in`.
  - Updated `PackItem` component to handle authentication internally, showing a "Log in to Buy" button if no session exists.
  - Improved `NavUser` logout flow to be more reliable.
- **UI Components**:
  - Created `components/buy-button.tsx` for reusable purchase logic.
  - Enhanced `PackItem` with `creditsSuffix` prop and customizable action area.

### Changed
- **Database Schema**:
  - Added `productId` to `invites` table to link invites to specific packs.
  - Made `email` field in `invites` table optional.
- **API & Hooks**:
  - Updated `/api/invites` and `useCreateInvite` to support optional email and `productId`.
  - Updated `getUserPendingInvites` to include product details.
- **Dashboard & UX**:
  - Removed deprecated public "View Page" and "Copy Link" actions from `PackActions` in favor of the new invite flow.
  - Consolidated purchase flow: users are redirected to the dashboard or invite page to buy, ensuring valid sessions.
  - Updated `InviteUserDialog` to support controlled state and pack selection.

### Removed
- Deleted `app/buy` directory as the purchase flow is now handled via invites and the dashboard.

## [Unreleased] - 2025-12-21

### Added
- Integrated **TanStack React Query** for robust client-side state management and caching.
- Created custom hooks for data fetching and mutations:
    - `hooks/use-products.ts`: `useProducts`, `useCreateProduct`, `useUpdateProductStatus`.
    - `hooks/use-invites.ts`: `useInvites`, `useCreateInvite`.
- Created API routes for developer integration:
    - `app/api/invites/route.ts`: Endpoints for listing and creating invites.
    - `app/api/products/route.ts`: Endpoints for listing and creating products.
    - `app/api/products/[id]/route.ts`: Endpoint for updating product status.
- Added "Developers" section to the Creator Dashboard:
    - New page at `app/dashboard/developers/page.tsx` with API documentation.
    - Added "Developers" link to the sidebar navigation.
- Installed `@tanstack/react-table` and `@tanstack/react-query` dependencies.

### Changed
- Refactored dashboard components to **Client Components** for improved interactivity:
    - `app/dashboard/packs/page.tsx`: Now uses `useProducts` hook for real-time updates and includes loading skeletons.
    - `app/dashboard/creator/page.tsx`: Refactored to use new client-side `RecentInvites` and `LivePacks` components.
- Migrated `CreatePackDialog` and `InviteUserDialog` to use custom mutation hooks instead of manual fetch/server actions.

## [Unreleased] - 2025-12-20

### Added
- Created `app/actions/dashboard.ts` to fetch dashboard statistics (revenue, active products, customers) and user subscriptions.

### Changed
- Updated `app/dashboard/page.tsx` to replace placeholder charts with real data:
    - Added "Your Live Packs" section.
    - Added "Your Credits" section.
    - Integrated `SectionCards` with real stats.
    - Fixed "Server Functions cannot be called during initial render" error by removing `"use client";` from `app/dashboard/page.tsx`, restoring it as a Server Component.
    - Prioritized "Active Subscriptions" view in dashboard home and added quick-buy options for available packs.
    - Refactored `app/dashboard/page.tsx` to serve as the "Consumer Dashboard" with relevant stats (Total Spent, Active Subscriptions).
- Refactored `components/app-sidebar.tsx` to clean up navigation:
    - Removed unused "Clouds" and "Documents" sections.
    - Simplified main navigation to "Dashboard", "Packs", and "Customers".
    - Integrated `better-auth` session to display real user name and avatar.
    - Added "My Subscriptions" section and reorganized "Creator" links into a labelled group.
    - Updated sidebar to provide distinct links for Consumer and Creator dashboards.
    - Removed "Create a new sub" button from sidebar.
- Updated `components/section-cards.tsx` to accept dynamic props (`totalRevenue`, `activeProducts`, `totalCustomers`) and remove hardcoded placeholder data.
- Fixed layout issues in `app/layout.tsx` by adding `min-h-screen flex flex-col` to body, ensuring vertical centering works correctly in auth pages.
- Added `Toaster` component to `app/layout.tsx` to enable error message display (e.g., "Password is too short") for `better-auth`.
- Updated `components/nav-user.tsx` to implement "Log out" functionality using `authClient.signOut` and redirect to sign-in page.
- Fixed sidebar navigation links in `components/nav-main.tsx` by using `next/link` and `asChild` on `SidebarMenuButton`.
- Renamed "Quick Create" button to "Create a new sub" and linked it to `/dashboard/packs`.
- Updated `components/nav-main.tsx` to support optional section labels.

### Added
- Created `app/actions/dashboard.ts` to fetch dashboard statistics (revenue, active products, customers) and user subscriptions.
- Added `app/dashboard/subscriptions/page.tsx` to list active subscriptions and available packs for purchase.
- Updated `app/actions/dashboard.ts` to enrich `getUserSubscriptions` with available packs for each creator.
- Created `app/dashboard/creator/page.tsx` for creator-specific stats and actions.
- Added `getConsumerStats` and `getCreatorStats` to `app/actions/dashboard.ts`.
- Added `components/consumer-stats-cards.tsx` for displaying consumer-specific metrics.
- Implemented invitation system:
    - Added `invites` table and `inviteStatusEnum` to database schema.
    - Created `app/actions/invites.ts` for managing invites (create, list, respond).
    - Added "Invite Customer" dialog in Creator Dashboard.
    - Added "Pending Invites" section in Consumer Subscriptions page.
    - Implemented logic to create 0-credit subscriptions upon accepting an invite.
