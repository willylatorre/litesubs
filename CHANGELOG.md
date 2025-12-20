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
- Refactored `components/app-sidebar.tsx` to clean up navigation:
    - Removed unused "Clouds" and "Documents" sections.
    - Simplified main navigation to "Dashboard", "Packs", and "Customers".
    - Integrated `better-auth` session to display real user name and avatar.
- Updated `components/section-cards.tsx` to accept dynamic props (`totalRevenue`, `activeProducts`, `totalCustomers`) and remove hardcoded placeholder data.
- Fixed layout issues in `app/layout.tsx` by adding `min-h-screen flex flex-col` to body, ensuring vertical centering works correctly in auth pages.
- Added `Toaster` component to `app/layout.tsx` to enable error message display (e.g., "Password is too short") for `better-auth`.
- Updated `components/nav-user.tsx` to implement "Log out" functionality using `authClient.signOut` and redirect to sign-in page.
- Fixed sidebar navigation links in `components/nav-main.tsx` by using `next/link` and `asChild` on `SidebarMenuButton`.
- Renamed "Quick Create" button to "Create a new sub" and linked it to `/dashboard/packs`.
