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

# Next tasks

### 🛠 Customer & Credit Management
- [x] **Detailed Plan view:** Implement a view for creators and customers to see a full ledger of credit changes (purchases, manual adjustments, API consumption). It is a strict link between customer-planId.
- [x] **Enhanced Credit UI:** Add the possibility to manually adjust credits, increase or decrease in the detailed plan view.
- [ ] **Account Management:** Allow users to view their billing history and manage their profile using the betterauth-UI components like `AccountView`

### 🔗 Public Pages & SEO

- [ ] **SEO Optimization:** Implement dynamic OpenGraph images and meta tags for pack sharing links. Use the favicon.svg as a logo.
- [ ] **Pack Detail Pages:** Improve the `token/page.tsx` page to have more information and SEO capabilities.
- [ ] **Public Creator Profiles:** A simple page listing all available packs for a specific creator. All the links in the end should redirect you to login/signup to litesubs.com in order to be able to subscribe.
- [ ] **Help & FAQ:** Add a dedicated Help/FAQ page for both creators and customers.

### 💻 Developer Experience (API)
- [ ] **API Key Management:** UI for creators to generate/revoke API keys for their projects.
- [ ] **Credit Consumption API:** Build a secure endpoint for external applications to deduct credits from a user's balance.
- [ ] **Webhooks:** Set up outgoing webhooks to notify external services of successful purchases or balance changes.

### 🚀 Polish & Performance
- [ ] **Performance Audit:** Review Server vs. Client component usage to optimize initial load times and interactivity.
- [ ] **Stripe Webhook Reliability:** Ensure idempotent processing of Stripe events to handle retries safely.
- [ ] **Cal.com Integration:** Explore allowing users to "spend" credits to book appointments via Cal.com.
