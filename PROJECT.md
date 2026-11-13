# Litesubs

## Overview
Litesubs is a streamlined platform for creators to sell credit plans. A plan is either a one-time pack or a monthly allowance. Creators prepare a plan as a draft, publish immutable terms on their own Stripe account, and customers consume credits over time.

This model establishes a direct relationship between the creator and the buyer, allowing creators to monetize their services or content flexibly without the complexity of managing recurring billing cycles initially.

## Core Features

### 1. Plan Management (Creator)
- **Create Plans:** A plan starts as a local draft with:
  - **Title/Name** and description
  - **Billing mode:** one-time pack or monthly plan
  - **Price and currency** (stored in minor units)
  - **Credit amount** granted per purchase or period
- **Drafts are not sellable:** publishing a version on the creator's Stripe account is the next slice; nothing is purchasable before that.
- **Replace terms safely:** service details stay editable while published commercial terms stay frozen for existing customers.
- **Share:** Generate invite links to published plans.

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
- [x] **Account Management:** Allow users to view their billing history and manage their profile using the betterauth-UI components like `AccountView`. Accessing to your account info should be done through the links in the `nav-user.tsx` component. You can learn more at https://better-auth-ui.com/llms.txt .
- [x] **Pack Detail Pages:** Improve the `token/page.tsx` page to have more information and SEO capabilities. Make it reusable so the creator can send it again to ask them for payment.
- [x] **Payment links:** Add the ability to generate stripe payment links for a specific combination of pack/customer. This should be able to be created from the Customer details modal, next to the subscription row.
- [x] **Payouts:** Create the whole payouts flow following the prompt in PAYOUTS.md

### 🔗 Public Pages & SEO

- [x] **Landing:** Improve the landing showcasing a simple three steps process to showcase how easy it is to setup a plan. Keep the minimalist approach.
- [x] **SEO Optimization:** Implement dynamic OpenGraph images and meta tags for pack sharing links. Use the favicon.svg as a logo. Checklist at https://dminhvu.com/post/nextjs-seo
- [x] **Pack Detail Pages:** Improve the `token/page.tsx` page to have more information and SEO capabilities. Make it reusable so the creator can send it again to ask them for payment.
- [x] **Help & FAQ:** Add a dedicated Help/FAQ page for both creators and customers.

### 🚀 Polish & Performance
- [x] **Performance Audit:** Review Server vs. Client component usage to optimize initial load times and interactivity. Perform an analysis of the main pages to address architectural correctness. See `PERFORMANCE_AUDIT.md` for full details.
 - [x] Analyze if calls can be optimized
 - [x] Divide complex pages in smaller subcomponents
 - [x] Generate a list of all the possible improvements and best practice recommendations to be taken. Divide them by page.
- [x] **Stripe Webhook Reliability:** Ensure idempotent processing of Stripe events to handle retries safely.
- [x] **Better ui:**
  - [x] Ensure font sizes across the whole app. All titles need to have the same font size and weight. Same thing goes for modals, buttons, etc.
  - [x] All cards need to have the same layouts and dimensions.
  - [x] All tables need to have the same layouts, dimensions and backgrounds.
  - [x] Make the decrease-credit-button component more elevated and minimalist. Same thing with the manage-subscription one.
  - [x] Ensure UI consistency.

### Integrations
- [x] **Stripe connect:** Explore allowing users to connect their own "stripe" account so the purchases of the packs will go directly to them. If connected, we skip/disable the whole Payouts section as it is handled automatically.
- [ ] **Cal.com Integration:** Explore allowing users to connect their account and automatically "spend" credits when booking appointments via Cal.com through a webhook.
- [ ] **Calendly Integration:** Explore allowing users to connect their account and automatically "spend" credits when booking appointments via Cal.com through a webhook.

### Subscriptions
- [x] **Subscriptions plan (S07–S13 billing slices):** Monthly plans use Stripe subscriptions and grant one expiring allowance per paid invoice. Recurring Checkout remains sandbox-only until the live-release gate is complete. Customers can cancel at period end, resume, manage creator-specific billing, claim invites whose credits carry an explicit expiry, and have refunds revoke only the refunded purchase's unspent units. Money reporting is derived from receipts, per currency.

### 💻 Developer Experience (API)
- [x] **API Key Management:** UI for creators to generate/revoke API keys for their projects. (`/dashboard/developers/api-keys`)
- [x] **Credit Consumption API:** Build a secure endpoint for external applications to deduct credits from a user's balance. (`POST /api/v1/credits/consume`, plus the `consume_credits` MCP tool)
- [ ] **Webhooks:** Set up outgoing webhooks to notify external services of successful purchases or balance changes.
