# Changelog

All notable changes to this project will be documented in this file.

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
