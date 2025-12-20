# Litesubs

## Overview
Litesubs is a streamlined platform designed for creators and individuals to generate and manage simple, non-renewing credit packs. Unlike traditional recurring subscriptions, Litesubs focuses on "packs" of credits that users can purchase and consume over time.

This model establishes a direct relationship between the creator and the buyer, allowing creators to monetize their services or content flexibly without the complexity of managing recurring billing cycles initially.

## Core Features

### 1. Pack Management (Creator)
- **Create Packs:** Creators can define a pack with:
  - **Title/Name**
  - **Price** (integration with Stripe)
  - **Credit Amount** (the value the user gets)
  - **Expiration Date** (optional)
- **Manage Packs:** Enable/Disable packs to control availability.
- **Share:** Generate unique links to share packs with potential customers.

### 2. Customer & Credit Management (Creator)
- **Customer List:** A dashboard view displaying all users who have purchased a pack.
- **Credit Adjustment:**
  - **Manual:** UI to manually increase or decrease a specific user's credit balance.
  - **API:** (Future/Advanced) Programmatic access to adjust credits.
- **Status Control:** Ability to stop or disable a user's access/subscription.

### 3. Purchase & Onboarding (User)
- **Invite/Share Link:** A specialized link that handles the flow:
  - Landing on the pack detail page.
  - Registration (if not logged in).
  - Immediate prompt to purchase the pack.
- **Payments:** Secure payment processing via Stripe.
- **Wallet:** Users can view their current credit balance for different creators.

## Tech Stack
- **Framework:** Next.js (App Router)
- **UI:** shadcn/ui, Tailwind CSS, Framer Motion
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** Better Auth 
- **Payments:** Stripe

---

# Implementation Plan

## Phase 1: Data Modeling & Core Backend
- [x] **Database Schema Design**
  - Define `packs` table (creator_id, name, price, credits, active, expiration).
  - Define `user_credits` or `subscriptions` table (user_id, pack_id, current_credits, status).
  - Define `transactions` table (audit log for credit changes).
- [ ] **Database Migration**
  - Generate and push Drizzle migrations.

## Phase 2: Creator Dashboard (Packs)
- [x] **Create Pack UI**
  - Form to input pack details (Name, Price, Credits).
  - Server Action to save pack to DB.
- [x] **Pack List**
  - Display created packs with status toggle (Active/Disabled).
  - "Copy Link" functionality for sharing.

## Phase 3: Public Views & Authentication
- [x] **Public Pack Page** (`/buy/[packId]`)
  - Fetch and display pack details publically.
  - Integration with Auth:
    - If user not logged in -> Redirect to Register -> Return to Pack Page.
    - If user logged in -> Show "Buy with Stripe" button.

## Phase 4: Stripe Integration
- [x] **Stripe Setup**
  - Configure Stripe SDK.
  - Create Checkout Sessions for packs.
- [x] **Webhooks**
  - Handle `checkout.session.completed`.
  - Create `user_credits` record upon successful payment.

## Phase 5: Creator Dashboard (Customers)
- [x] **Customer Table**
  - Fetch users who bought packs from the current creator.
  - Display current credit balance.
- [x] **Credit Management Actions**
  - UI (Dialog/Popover) to "Add/Remove Credits".
  - Server Action to update `user_credits` and log to `transactions`.

## Phase 6: Polish & API
- [ ] **Landing Page Update**
  - Refresh `app/page.tsx` to reflect current branding and features.
- [ ] **API Endpoint (Basic)**
  - Endpoint for creators to check a user's balance programmatically.