# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2025-12-22

### Added
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