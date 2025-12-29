Here's a comprehensive prompt for implementing the payout system:

---

# PROMPT: Implement Stripe Payouts System for LiteSubs

## Project Context
LiteSubs is a platform where creators sell credit-based plans to customers. Currently:
- Users register with Better-Auth
- Stripe customers are automatically created for each user
- Payments go to the main Stripe account
- We need to implement a payout system so creators can withdraw their earnings

## Feature Requirements

### Core Functionality
Implement a complete payout system that allows creators to request payouts from their accumulated earnings using Stripe Payouts API. Payouts should be on-demand only (no automatic scheduling).

### Database Schema Migration

Create a new migration that includes:

**1. Creator Payout Accounts Table** (`creator_payout_accounts`)
- `id` (primary key)
- `user_id` (foreign key to users table, unique)
- `account_holder_name` (string, required)
- `account_type` (enum: 'individual' or 'business')
- `bank_account_number` (string, encrypted, required)
- `bank_routing_number` (string, required) - or appropriate field for country
- `bank_country` (string, required, default 'US')
- `bank_currency` (string, required, default 'USD')
- `tax_id` (string, encrypted, nullable) - SSN/EIN for US tax reporting
- `address_line1` (string, required)
- `address_line2` (string, nullable)
- `address_city` (string, required)
- `address_state` (string, required)
- `address_postal_code` (string, required)
- `address_country` (string, required)
- `verification_status` (enum: 'pending', 'verified', 'failed')
- `stripe_recipient_id` (string, nullable) - if Stripe creates a recipient object
- `is_active` (boolean, default true)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**2. Payouts Table** (`payouts`)
- `id` (primary key)
- `user_id` (foreign key to users table)
- `amount` (decimal, precise to 2 decimals) - amount in dollars/currency
- `currency` (string, default 'USD')
- `platform_fee` (decimal) - your fee deducted
- `net_amount` (decimal) - amount actually sent
- `status` (enum: 'pending', 'processing', 'completed', 'failed', 'cancelled')
- `stripe_payout_id` (string, nullable)
- `stripe_transfer_id` (string, nullable)
- `failure_code` (string, nullable)
- `failure_message` (text, nullable)
- `requested_at` (timestamp)
- `processed_at` (timestamp, nullable)
- `completed_at` (timestamp, nullable)
- `notes` (text, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**3. Earnings Ledger Table** (`earnings_ledger`)
- `id` (primary key)
- `user_id` (foreign key to users table)
- `transaction_type` (enum: 'sale', 'payout', 'refund', 'adjustment')
- `amount` (decimal) - positive for earnings, negative for payouts
- `related_payment_intent_id` (string, nullable) - Stripe payment intent
- `related_payout_id` (foreign key to payouts table, nullable)
- `description` (text)
- `created_at` (timestamp)

Add indexes on:
- `creator_payout_accounts.user_id`
- `payouts.user_id`
- `payouts.status`
- `earnings_ledger.user_id`
- `earnings_ledger.transaction_type`

### Business Logic Requirements

**Platform Fee Structure:**
- Set platform fee percentage: 10% (make this configurable)
- Fee should be deducted from gross earnings before payout
- Example: Creator earns $100 → Platform keeps $10 → Payout is $90

**Minimum Payout Threshold:**
- Set minimum payout amount: $50 USD
- Users cannot request payouts below this amount
- Display clear message when threshold not met

**Payout Eligibility Rules:**
1. User must have completed payout account setup
2. Available balance must be ≥ $50
3. No pending payout already in progress
4. Bank account must be verified (status = 'verified')
5. User account must be in good standing

**Available Balance Calculation:**
```
Available Balance = Total Earnings - Platform Fees - Previous Payouts - Pending Payouts
```

Calculate this by summing the `earnings_ledger` table for each user.

### API Endpoints to Implement

**1. GET `/api/payouts/balance`**
- Returns current available balance, total earnings, total paid out
- Response:
```json
{
  "total_earnings": 1000.00,
  "platform_fees": 100.00,
  "total_paid_out": 450.00,
  "pending_payouts": 0.00,
  "available_balance": 450.00,
  "can_request_payout": true,
  "minimum_payout": 50.00
}
```

**2. GET `/api/payouts/account`**
- Returns creator's payout account info (masked sensitive data)
- Returns null if not set up yet

**3. POST `/api/payouts/account`**
- Creates or updates payout account
- Validates all required fields
- Encrypts sensitive data (account numbers, tax IDs)
- Validates bank routing number format
- Returns validation errors if any

**4. GET `/api/payouts/history`**
- Returns paginated list of past payouts
- Include status, amounts, dates
- Order by most recent first

**5. POST `/api/payouts/request`**
- Creates a new payout request
- Body: `{ "amount": 450.00 }`
- Validations:
  - Amount must be ≤ available balance
  - Amount must be ≥ minimum threshold
  - No pending payout exists
  - Payout account is set up and verified
  - Bank account details are complete
- On success:
  1. Create payout record with status 'pending'
  2. Call Stripe Payouts API
  3. Update status to 'processing' if Stripe accepts
  4. Create negative entry in earnings_ledger
  5. Return payout details

**6. POST `/api/payouts/:id/cancel`** (optional, for pending only)
- Cancels a payout request that hasn't been processed yet
- Only works if status is still 'pending'

### Stripe Integration

**Use Stripe Payouts API:**
```javascript
// Example structure (adapt to your backend language)
const payout = await stripe.payouts.create({
  amount: netAmountInCents, // amount in cents
  currency: 'usd',
  method: 'standard', // or 'instant' for debit cards
  destination: bankAccountToken, // or bank account ID
  statement_descriptor: 'LITESUBS PAYOUT',
  metadata: {
    user_id: userId,
    payout_id: payoutId
  }
});
```

**Bank Account Creation:**
When user submits payout account info, create a bank account token with Stripe:
```javascript
const bankAccount = await stripe.tokens.create({
  bank_account: {
    country: 'US',
    currency: 'usd',
    account_holder_name: 'Jenny Rosen',
    account_holder_type: 'individual',
    routing_number: '110000000',
    account_number: '000123456789'
  }
});
```

**Webhook Handling:**
Set up webhook handler for:
- `payout.paid` - Update payout status to 'completed'
- `payout.failed` - Update status to 'failed', log failure reason, notify user
- `payout.canceled` - Update status to 'cancelled'

### Frontend Components to Build

**1. Payouts Dashboard Page** (`/dashboard/payouts`)

Display:
- **Balance Card** (prominent at top):
  - Large display of available balance
  - Total earnings (all time)
  - Total paid out (all time)
  - Platform fee rate (e.g., "10% platform fee")
  - Next payout eligible amount

- **Request Payout Button**:
  - Disabled if balance < minimum
  - Shows tooltip explaining why if disabled
  - Opens payout request dialog when clicked

- **Payout Account Status**:
  - Show if account is set up or needs setup
  - "Setup Payout Account" button if not configured
  - Summary of configured account (last 4 digits) if set up
  - "Edit Account" option

- **Payout History Table**:
  - Columns: Date, Amount, Status, Transaction ID
  - Status badges with colors (pending=yellow, completed=green, failed=red)
  - Paginated list
  - Empty state if no payouts yet

**2. Payout Account Setup Dialog/Page**

Form with sections:
- **Account Holder Information**:
  - Full legal name (must match bank account)
  - Account type (Individual/Business)
  
- **Bank Account Details**:
  - Bank country (dropdown)
  - Account number (with show/hide toggle)
  - Routing number (with validation)
  - Confirm account number field
  
- **Address Information** (required for compliance):
  - Street address
  - City, State, ZIP
  - Country
  
- **Tax Information** (US only):
  - SSN or EIN (encrypted)
  - Explanation: "Required for tax reporting (1099-K) if you earn over $600/year"
  - Make this optional but show warning

- **Validation & Security**:
  - Show real-time validation errors
  - Confirm all fields before submitting
  - Show encryption/security badges
  - "Your information is encrypted and secure" message

**3. Request Payout Dialog**

- Display available balance prominently
- Input field for amount (pre-filled with max available)
- Show calculation breakdown:
  ```
  Request amount: $450.00
  Platform fee (10%): Already deducted
  You will receive: $450.00
  ```
- Minimum threshold warning if applicable
- Bank account summary (last 4 digits)
- Expected processing time (e.g., "5-7 business days")
- Confirmation checkbox: "I confirm the bank account details are correct"
- "Request Payout" button
- Cancel button

**4. Success/Error States**

- Success toast: "Payout request submitted! Funds will arrive in 5-7 business days"
- Error toast with specific message
- Failed payout notification in dashboard with retry option

**5. FAQ Section**
- Create a FAQ section in the payouts dashboard with all the information defined.
- Use the Accordion component from Shadcn

### Edge Cases & Error Handling

**1. Insufficient Stripe Balance**
- Check your platform's Stripe balance before initiating payout
- If insufficient, show error: "Unable to process payout due to insufficient platform balance. Please contact support."
- Log this for monitoring

**2. Invalid Bank Account**
- Stripe will validate routing numbers
- Catch validation errors and display clearly
- Don't save invalid account details

**3. Payout Failures**
- Stripe might fail payouts (closed account, invalid details, etc.)
- Update status to 'failed'
- Restore the amount to available balance (reverse the ledger entry)
- Email user with failure reason
- Allow retry with account correction

**4. Concurrent Payout Requests**
- Use database transactions to prevent race conditions
- Lock the user's balance calculation during payout request
- Return error if payout already in progress

**5. Refunds & Chargebacks**
- If a sale is refunded, create negative entry in earnings_ledger
- Reduce available balance accordingly
- If balance goes negative, user must resolve before requesting payout
- Consider holding period (e.g., 7 days after sale before funds available)

**6. Account Closure**
- If user deletes account with pending payout, handle gracefully
- Complete pending payouts before allowing account deletion

**7. Currency Handling**
- For now, assume USD and EUR only
- But structure code to support multiple currencies later
- Store all amounts as decimals with 2 decimal precision

**8. Tax Reporting**
- Log warning in admin panel when creator crosses $600 threshold
- You'll need to generate 1099-K forms annually (outside scope for now)
- Collect tax IDs during payout account setup

**9. Suspicious Activity**
- Set maximum payout amount (e.g., $10,000 per request)
- Flag accounts with unusual patterns for manual review
- Implement rate limiting (e.g., max 1 payout per week)

**10. Partial Payouts**
- Allow users to request partial amounts (not just full balance)
- Minimum must still be $50 though

### Security Considerations

1. **Encrypt sensitive data**: Use field-level encryption for:
   - Bank account numbers
   - Tax IDs (SSN/EIN)
   - Use your backend's encryption library

2. **Access control**: 
   - Users can only view/edit their own payout info
   - Admin role can view all payouts for support

3. **Audit logging**:
   - Log all payout requests and status changes
   - Log payout account changes

4. **Rate limiting**:
   - Limit payout requests to prevent abuse
   - Limit account setup attempts

5. **Input validation**:
   - Sanitize all inputs
   - Validate routing numbers against known formats
   - Validate tax ID formats (SSN: XXX-XX-XXXX)

### Warnings & User Communication

**Warning Messages to Display:**

1. **Minimum threshold not met**:
   "You need at least $50.00 to request a payout. Current balance: $XX.XX"

2. **Payout account not set up**:
   "Please set up your payout account before requesting a payout."

3. **Bank account pending verification**:
   "Your bank account is being verified. This may take 1-2 business days."

4. **Pending payout exists**:
   "You already have a payout in progress. Please wait for it to complete before requesting another."

5. **Processing time**:
   "Payouts typically arrive in 5-7 business days via standard ACH transfer."

6. **Platform fee notice**:
   "A 10% platform fee has already been deducted from your earnings."

7. **Tax information**:
   "For US creators: We're required to report earnings over $600/year to the IRS. You'll receive a 1099-K form."

### Testing Checklist

- [ ] Create payout account with valid details
- [ ] Create payout account with invalid routing number (should fail)
- [ ] Request payout with sufficient balance
- [ ] Request payout with insufficient balance (should fail)
- [ ] Request payout below minimum threshold (should fail)
- [ ] Request second payout while one pending (should fail)
- [ ] Simulate successful payout webhook
- [ ] Simulate failed payout webhook
- [ ] Verify balance calculations are correct
- [ ] Test with Stripe test mode accounts
- [ ] Verify encryption of sensitive data
- [ ] Test concurrent payout requests
- [ ] Verify ledger entries are created correctly
- [ ] Test payout cancellation
- [ ] Verify email notifications work

### Admin Panel Requirements (Optional but Recommended)

Create admin view to:
- See all pending payouts
- View payout history across all users
- Manually approve/reject flagged payouts
- View failed payouts and reasons
- Export payout data for accounting
- Monitor total platform fees collected

### Monitoring & Alerts

Set up monitoring for:
- Failed payouts (alert immediately)
- Low Stripe balance (before it blocks payouts)
- Unusual payout patterns
- High failure rates
- Users hitting errors repeatedly

### Documentation to Write

1. User-facing help doc: "How to Set Up Payouts"
2. User-facing help doc: "When Will I Receive My Payout?"
3. Internal doc: Payout processing workflow
4. Internal doc: Handling failed payouts

---

## Implementation Notes

- Use Stripe test mode during development
- Test with Stripe's test bank account numbers
- Implement comprehensive error handling and logging
- Consider implementing idempotency keys for payout requests
- Store Stripe webhook events for audit trail
- Make platform fee percentage configurable (environment variable)

## Success Criteria

- Creators can set up payout accounts
- Creators can view their available balance accurately
- Creators can request payouts successfully
- Payouts appear in Stripe dashboard
- Webhook updates reflect in database correctly
- All edge cases are handled gracefully
- UI is clear and prevents user errors

---

Please implement this feature following best practices for your tech stack. Ask clarifying questions if any requirements are ambiguous.