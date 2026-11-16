import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import {
	BILLING_INTERVALS,
	BILLING_MODES,
	CURRENCIES,
	INVITE_STATUSES,
	PLAN_VERSION_STATUSES,
	TRANSACTION_STATUSES,
	TRANSACTION_TYPES,
} from "@/lib/constants";
import { user } from "./auth-schema";

// Re-export auth schema
export * from "./auth-schema";
export * from "./mcp-auth-schema";
export * from "./stripe-connect-schema";

// Enums
export const billingModeEnum = pgEnum("billing_mode", BILLING_MODES);
export const billingIntervalEnum = pgEnum(
	"billing_interval",
	BILLING_INTERVALS,
);
export const planVersionStatusEnum = pgEnum(
	"plan_version_status",
	PLAN_VERSION_STATUSES,
);
export const transactionTypeEnum = pgEnum(
	"transaction_type",
	TRANSACTION_TYPES,
);
export const transactionStatusEnum = pgEnum(
	"transaction_status",
	TRANSACTION_STATUSES,
);
export const inviteStatusEnum = pgEnum("invite_status", INVITE_STATUSES);
export const currencyEnum = pgEnum("currency", CURRENCIES);
export const integrationTypeEnum = pgEnum("integration_type", ["calcom"]);
export const customerProvisioningEnum = pgEnum("customer_provisioning", [
	"provisioning",
	"ready",
	"failed",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
	"pending",
	"paid",
	"failed",
	"expired",
	"refunded",
]);
export const grantKindEnum = pgEnum("grant_kind", [
	"purchase",
	"comp",
	"adjustment",
	"period",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
	"pending",
	"incomplete",
	"active",
	"past_due",
	"canceled",
]);
/** Who stopped renewals; a disconnect must never read as a customer action. */
export const subscriptionCancellationCauseEnum = pgEnum(
	"subscription_cancellation_cause",
	["customer", "creator_disconnect"],
);

// Tables

export const calcomIntegrations = pgTable(
	"calcom_integrations",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventTypeId: integer("event_type_id"),
		eventTypeSlug: text("event_type_slug"),
		eventTypeName: text("event_type_name"),
		eventTypeUrl: text("event_type_url"),
		connectedAt: timestamp("connected_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("calcom_event_type_id_idx").on(table.eventTypeId),
		index("calcom_event_type_slug_idx").on(table.eventTypeSlug),
	],
);

export const integrations = pgTable(
	"integrations",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: integrationTypeEnum("type").notNull(),
		calcomIntegrationId: text("calcom_integration_id").references(
			() => calcomIntegrations.id,
			{ onDelete: "cascade" },
		),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("integrations_user_idx").on(table.userId),
		index("integrations_type_idx").on(table.type),
	],
);

/**
 * Editable service identity for an offer. Commercial terms live in
 * `planVersions` so a published price can never be mutated underneath an
 * existing customer. A plan with no published version is a draft: visible and
 * editable, never purchasable.
 */
export const plans = pgTable(
	"plans",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		integrationId: text("integration_id").references(() => integrations.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("plan_creator_idx").on(table.creatorId),
		index("plan_created_at_idx").on(table.createdAt),
	],
);

/**
 * Commercial terms. `draft` rows are the creator's working copy and stay
 * mutable until publishing converts them into an immutable `published` row.
 * Prices are stored in minor units of `currency`.
 */
export const planVersions = pgTable(
	"plan_versions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		planId: text("plan_id")
			.notNull()
			.references(() => plans.id, { onDelete: "cascade" }),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		status: planVersionStatusEnum("status").default("draft").notNull(),
		billingMode: billingModeEnum("billing_mode").notNull(),
		interval: billingIntervalEnum("interval"),
		currency: currencyEnum("currency").default("usd").notNull(),
		price: integer("price").notNull(), // minor units
		credits: integer("credits").notNull(),
		version: integer("version").notNull().default(1),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		unpublishedAt: timestamp("unpublished_at", { withTimezone: true }),
		/**
		 * Stripe objects owned by the creator's account. They are recorded only
		 * for a version that was provisioned, so a published row can never exist
		 * without the offer it sells. Retries reuse them instead of creating a
		 * second Product/Price; the draft is a separate row and never holds them.
		 */
		stripeAccountId: text("stripe_account_id"),
		stripeProductId: text("stripe_product_id"),
		stripePriceId: text("stripe_price_id"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("plan_version_plan_idx").on(table.planId),
		index("plan_version_creator_idx").on(table.creatorId),
		unique("plan_version_number_unique").on(table.planId, table.version),
		// At most one working copy per plan.
		uniqueIndex("plan_version_single_draft_idx")
			.on(table.planId)
			.where(sql`${table.status} = 'draft'`),
		// At most one offer is sellable at a time; a replacement supersedes the
		// previous version rather than leaving two current prices in Stripe.
		uniqueIndex("plan_version_single_published_idx")
			.on(table.planId)
			.where(sql`${table.status} = 'published'`),
		check("plan_version_price_non_negative", sql`${table.price} >= 0`),
		check("plan_version_credits_positive", sql`${table.credits} > 0`),
		// Monthly is the only recurring interval in v1; one-time offers have none.
		check(
			"plan_version_interval_matches_mode",
			sql`(${table.billingMode} = 'one_time' and ${table.interval} is null) or (${table.billingMode} = 'recurring' and ${table.interval} = 'month')`,
		),
	],
);

/**
 * A customer's relationship with one plan and its credit balance projection.
 * Recurring billing identities are separate rows in `subscriptions`.
 */
export const enrollments = pgTable(
	"enrollments",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		planId: text("plan_id")
			.notNull()
			.references(() => plans.id, { onDelete: "cascade" }),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		credits: integer("credits").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("enrollment_user_idx").on(table.userId),
		index("enrollment_plan_idx").on(table.planId),
		index("enrollment_creator_idx").on(table.creatorId),
		unique("user_plan_unique").on(table.userId, table.planId),
		// Backstop for the credit write funnel: balances can never go negative.
		check("enrollment_credits_non_negative", sql`${table.credits} >= 0`),
	],
);

export const transactions = pgTable(
	"transactions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		planId: text("plan_id").references(() => plans.id, {
			onDelete: "set null",
		}),
		amount: integer("amount").notNull(), // Positive for add, negative for remove/usage
		amountMoney: integer("amount_money"), // The cost in minor units if it was a purchase
		currency: currencyEnum("currency"), // The currency if amountMoney is set
		type: transactionTypeEnum("type").notNull(),
		status: transactionStatusEnum("status").default("ongoing").notNull(),
		description: text("description"),
		stripeCheckoutId: text("stripe_checkout_id").unique(),
		/**
		 * The recurring invoice receipt this entry records, so a refund can find
		 * the exact grant it must revoke instead of scanning the plan balance.
		 */
		subscriptionInvoiceId: text("subscription_invoice_id").references(
			() => subscriptionInvoices.id,
			{ onDelete: "set null" },
		),
		// Stripe Connect fields
		usesStripeConnect: boolean("uses_stripe_connect").default(false),
		stripeApplicationFee: integer("stripe_application_fee"), // Platform fee in minor units
		stripeConnectAccountId: text("stripe_connect_account_id"), // Connected account ID
		/**
		 * The exact published terms this credit movement belongs to. A purchase
		 * grant is source-linked to its immutable version, so a later price change
		 * never rewrites what a customer bought.
		 */
		planVersionId: text("plan_version_id").references(() => planVersions.id, {
			onDelete: "set null",
		}),
		// Caller-supplied key that makes credit writes retry-safe. Nullable so
		// purchase/Stripe rows are unaffected; only `usage` writes require it.
		idempotencyKey: text("idempotency_key"),
		balanceBefore: integer("balance_before"),
		balanceAfter: integer("balance_after"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("tx_user_idx").on(table.userId),
		index("tx_creator_idx").on(table.creatorId),
		index("tx_plan_idx").on(table.planId),
		index("tx_created_at_idx").on(table.createdAt),
		index("tx_user_type_idx").on(table.userId, table.type),
		index("tx_creator_type_idx").on(table.creatorId, table.type),
		index("tx_uses_connect_idx").on(table.usesStripeConnect),
		// Scoped to the creator so two creators can use the same key.
		uniqueIndex("tx_creator_idempotency_idx")
			.on(table.creatorId, table.idempotencyKey)
			.where(sql`${table.idempotencyKey} is not null`),
		index("tx_plan_version_idx").on(table.planVersionId),
		index("tx_subscription_invoice_idx").on(table.subscriptionInvoiceId),
	],
);

/**
 * A creator's Stripe Customer on **their own** connected account.
 *
 * Stripe Customers are account-scoped, so the same Litesubs user is a different
 * Customer object for every creator they buy from. This mapping is what makes
 * "reuse one intended Customer" possible without ever passing a platform
 * Customer to a connected account.
 *
 * `provisioning` is a claim row: it is inserted before the Stripe call so two
 * concurrent first purchases cannot both create a Customer. The unique
 * (creator, user) constraint makes the race resolve in the database.
 */
export const creatorCustomers = pgTable(
	"creator_customers",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The account this Customer belongs to; never the platform account. */
		stripeAccountId: text("stripe_account_id"),
		stripeCustomerId: text("stripe_customer_id"),
		status: customerProvisioningEnum("status")
			.default("provisioning")
			.notNull(),
		email: text("email"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		unique("creator_customer_unique").on(table.creatorId, table.userId),
		index("creator_customer_creator_idx").on(table.creatorId),
		index("creator_customer_user_idx").on(table.userId),
		// One Stripe Customer cannot be shared across creators' accounts.
		uniqueIndex("creator_customer_stripe_unique")
			.on(table.stripeAccountId, table.stripeCustomerId)
			.where(sql`${table.stripeCustomerId} is not null`),
	],
);

/**
 * One row per Checkout attempt, written when the session is created.
 *
 * This is the payment receipt and the audit trail: it records the intended
 * terms, the amount actually charged, the application fee, and the account the
 * charge belongs to. Fulfillment reads it rather than trusting metadata alone.
 */
export const payments = pgTable(
	"payments",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		planId: text("plan_id")
			.notNull()
			.references(() => plans.id, { onDelete: "cascade" }),
		planVersionId: text("plan_version_id")
			.notNull()
			.references(() => planVersions.id, { onDelete: "restrict" }),
		stripeAccountId: text("stripe_account_id").notNull(),
		stripeCustomerId: text("stripe_customer_id"),
		stripeCheckoutId: text("stripe_checkout_id").unique(),
		stripePaymentIntentId: text("stripe_payment_intent_id"),
		status: paymentStatusEnum("status").default("pending").notNull(),
		/** Intended terms at session creation; the charge cannot silently differ. */
		credits: integer("credits").notNull(),
		amountTotal: integer("amount_total").notNull(),
		currency: currencyEnum("currency").notNull(),
		applicationFee: integer("application_fee").notNull(),
		/** Amount actually paid, recorded at fulfillment. */
		amountPaid: integer("amount_paid"),
		/** Succeeded refunds applied to this receipt, cumulative. */
		amountRefunded: integer("amount_refunded").default(0).notNull(),
		refundedAt: timestamp("refunded_at", { withTimezone: true }),
		fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("payment_creator_idx").on(table.creatorId),
		index("payment_user_idx").on(table.userId),
		index("payment_plan_idx").on(table.planId),
		index("payment_status_idx").on(table.status),
		check("payment_amounts_non_negative", sql`${table.amountTotal} >= 0`),
		check(
			"payment_refunded_bounded",
			sql`${table.amountRefunded} >= 0 and (${table.amountPaid} is null or ${table.amountRefunded} <= ${table.amountPaid})`,
		),
	],
);

/**
 * One successful refund against an account-scoped payment.
 *
 * Stripe may deliver the same refund repeatedly and out of order, so the
 * (account, refund) pair is the idempotency boundary. The row records what was
 * refunded and what credit effect it produced, keeping the financial and ledger
 * histories independently traceable.
 */
export const refunds = pgTable(
	"refunds",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		/** Set for a one-time pack receipt; null for a subscription invoice. */
		paymentId: text("payment_id").references(() => payments.id, {
			onDelete: "cascade",
		}),
		/** Set for a recurring invoice receipt; never for a pack refund. */
		subscriptionInvoiceId: text("subscription_invoice_id").references(
			() => subscriptionInvoices.id,
			{ onDelete: "cascade" },
		),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		stripeAccountId: text("stripe_account_id").notNull(),
		stripeRefundId: text("stripe_refund_id").notNull(),
		amount: integer("amount").notNull(),
		currency: currencyEnum("currency").notNull(),
		/** Units revoked from the payment's own grants by this refund. */
		revokedCredits: integer("revoked_credits").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("refund_account_id_unique").on(
			table.stripeAccountId,
			table.stripeRefundId,
		),
		index("refund_payment_idx").on(table.paymentId),
		index("refund_creator_idx").on(table.creatorId),
		check("refund_amount_positive", sql`${table.amount} > 0`),
		check("refund_revoked_non_negative", sql`${table.revokedCredits} >= 0`),
	],
);

/**
 * Stripe billing identity for a monthly plan. Stripe remains authoritative for
 * recurring billing; the local row records the owning account, purchased terms,
 * and the paid-through boundary needed to expire the current allowance.
 */
export const subscriptions = pgTable(
	"subscriptions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		planId: text("plan_id")
			.notNull()
			.references(() => plans.id, { onDelete: "cascade" }),
		planVersionId: text("plan_version_id")
			.notNull()
			.references(() => planVersions.id, { onDelete: "restrict" }),
		stripeAccountId: text("stripe_account_id").notNull(),
		stripeCustomerId: text("stripe_customer_id").notNull(),
		stripeCheckoutId: text("stripe_checkout_id").unique(),
		stripeSubscriptionId: text("stripe_subscription_id").unique(),
		status: subscriptionStatusEnum("status").default("pending").notNull(),
		/** Stored as percent (2 means 2%), not a fraction. */
		applicationFeePercent: integer("application_fee_percent").notNull(),
		paidThroughAt: timestamp("paid_through_at", { withTimezone: true }),
		cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
		cancelAt: timestamp("cancel_at", { withTimezone: true }),
		/**
		 * Who stopped renewals: the customer (S09) or the creator's Stripe
		 * disconnection (S15). Kept explicit so support and history never present
		 * a platform-driven stop as the customer's own choice.
		 */
		cancellationCause: subscriptionCancellationCauseEnum("cancellation_cause"),
		cancellationRevision: integer("cancellation_revision").default(0).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("subscription_creator_idx").on(table.creatorId),
		index("subscription_user_idx").on(table.userId),
		index("subscription_plan_idx").on(table.planId),
		uniqueIndex("subscription_one_live_per_customer_plan_idx")
			.on(table.creatorId, table.userId, table.planId)
			.where(sql`${table.status} <> 'canceled'`),
		check(
			"subscription_fee_percent_positive",
			sql`${table.applicationFeePercent} > 0 and ${table.applicationFeePercent} < 100`,
		),
		check(
			"subscription_cancellation_revision_non_negative",
			sql`${table.cancellationRevision} >= 0`,
		),
	],
);

/** Paid invoice receipt and idempotency boundary for a monthly allowance. */
export const subscriptionInvoices = pgTable(
	"subscription_invoices",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		subscriptionId: text("subscription_id")
			.notNull()
			.references(() => subscriptions.id, { onDelete: "cascade" }),
		stripeAccountId: text("stripe_account_id").notNull(),
		stripeInvoiceId: text("stripe_invoice_id").notNull(),
		/** Resolves a refund on this invoice's charge back to its receipt. */
		stripePaymentIntentId: text("stripe_payment_intent_id"),
		amountPaid: integer("amount_paid").notNull(),
		/** Succeeded refunds applied to this invoice, cumulative. */
		amountRefunded: integer("amount_refunded").default(0).notNull(),
		refundedAt: timestamp("refunded_at", { withTimezone: true }),
		currency: currencyEnum("currency").notNull(),
		periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
		periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
		paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
		creditedAt: timestamp("credited_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("subscription_invoice_account_id_unique").on(
			table.stripeAccountId,
			table.stripeInvoiceId,
		),
		uniqueIndex("subscription_invoice_period_unique").on(
			table.subscriptionId,
			table.periodStart,
			table.periodEnd,
		),
		index("subscription_invoice_subscription_idx").on(table.subscriptionId),
		check(
			"subscription_invoice_amount_non_negative",
			sql`${table.amountPaid} >= 0`,
		),
		check(
			"subscription_invoice_refunded_bounded",
			sql`${table.amountRefunded} >= 0 and ${table.amountRefunded} <= ${table.amountPaid}`,
		),
		check(
			"subscription_invoice_period_valid",
			sql`${table.periodEnd} > ${table.periodStart}`,
		),
	],
);

/**
 * Single-use, authenticated purchase requests.
 *
 * A creator used to send the customer a link carrying that customer's identity,
 * which was reusable by anyone who saw it. Now the link carries only an opaque
 * token; the recipient signs in, and the token is consumed on first use so it
 * cannot be forwarded to buy someone else's plan.
 */
export const checkoutTokens = pgTable(
	"checkout_tokens",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		tokenHash: text("token_hash").notNull().unique(),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		planId: text("plan_id")
			.notNull()
			.references(() => plans.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("checkout_token_creator_idx").on(table.creatorId),
		index("checkout_token_expiry_idx").on(table.expiresAt),
	],
);

/**
 * A pool of credits a customer can spend, and where it came from.
 *
 * Every positive credit movement is a grant: a purchase, a complimentary
 * enrollment, or a creator's manual increase. Consumption allocates across
 * grants instead of decrementing one undifferentiated balance, which is what
 * makes spending attributable and expiry enforceable without a cron job.
 *
 * `remaining` and `expiresAt` are the spendable truth. The enrollment balance is
 * a projection kept in step by the same transaction.
 */
export const creditGrants = pgTable(
	"credit_grants",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		enrollmentId: text("enrollment_id")
			.notNull()
			.references(() => enrollments.id, { onDelete: "cascade" }),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		planId: text("plan_id")
			.notNull()
			.references(() => plans.id, { onDelete: "cascade" }),
		/** The terms that produced this grant, when it came from a version. */
		planVersionId: text("plan_version_id").references(() => planVersions.id, {
			onDelete: "set null",
		}),
		/** The ledger row that created it, so history is source-linked both ways. */
		sourceTransactionId: text("source_transaction_id"),
		kind: grantKindEnum("kind").notNull(),
		/** Granted units, never changes after creation. */
		amount: integer("amount").notNull(),
		/** Units still spendable. Decremented only by allocation. */
		remaining: integer("remaining").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("credit_grant_enrollment_idx").on(table.enrollmentId),
		index("credit_grant_creator_idx").on(table.creatorId),
		index("credit_grant_user_idx").on(table.userId),
		index("credit_grant_expiry_idx").on(table.expiresAt),
		check("credit_grant_amount_positive", sql`${table.amount} > 0`),
		check(
			"credit_grant_remaining_bounded",
			sql`${table.remaining} >= 0 and ${table.remaining} <= ${table.amount}`,
		),
	],
);

/**
 * Which grant paid for which unit of a debit.
 *
 * Allocations are the audit trail behind a usage entry: they let a creator see
 * that a debit of 7 came from 5 units of one pack and 2 of another, and they
 * make "consumed across more than one grant" verifiable rather than implied.
 */
export const creditAllocations = pgTable(
	"credit_allocations",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		transactionId: text("transaction_id")
			.notNull()
			.references(() => transactions.id, { onDelete: "cascade" }),
		grantId: text("grant_id")
			.notNull()
			.references(() => creditGrants.id, { onDelete: "cascade" }),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Units taken from this grant for this debit. Always positive. */
		amount: integer("amount").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("credit_allocation_transaction_idx").on(table.transactionId),
		index("credit_allocation_grant_idx").on(table.grantId),
		index("credit_allocation_creator_idx").on(table.creatorId),
		check("credit_allocation_amount_positive", sql`${table.amount} > 0`),
	],
);

export const invites = pgTable(
	"invites",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		creatorId: text("creator_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		email: text("email"),
		status: inviteStatusEnum("status").default("pending").notNull(),
		// Comp grants are snapshotted when invited and applied once on claim.
		compCredits: integer("comp_credits").notNull().default(0),
		compReason: text("comp_reason"),
		/** Fixed expiry for a comp issued before any paid period exists. */
		compExpiresAt: timestamp("comp_expires_at", { withTimezone: true }),
		token: text("token").notNull().unique(), // unique string for the link
		planId: text("plan_id").references(() => plans.id, {
			onDelete: "set null",
		}),
		/**
		 * The exact published terms shown when the invite was issued. Claiming
		 * must not silently apply a newer draft, and must still refuse a version
		 * that has since been unpublished.
		 */
		planVersionId: text("plan_version_id").references(() => planVersions.id, {
			onDelete: "set null",
		}),
		// Invite links used to be valid forever, so a shared or leaked URL stayed
		// claimable indefinitely.
		expiresAt: timestamp("expires_at")
			.notNull()
			.default(sql`now() + interval '14 days'`),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("invite_creator_idx").on(table.creatorId),
		index("invite_email_idx").on(table.email),
		index("invite_email_status_idx").on(table.email, table.status),
	],
);

export const calComAccounts = pgTable(
	"cal_com_accounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token").notNull(),
		refreshToken: text("refresh_token"),
		expiresAt: timestamp("expires_at"),
		scope: text("scope"),
		calUserId: text("cal_user_id"),
		calUsername: text("cal_username"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [unique("cal_com_accounts_user_id_unique").on(table.userId)],
);

// Relations

export const plansRelations = relations(plans, ({ one, many }) => ({
	creator: one(user, {
		fields: [plans.creatorId],
		references: [user.id],
	}),
	integration: one(integrations, {
		fields: [plans.integrationId],
		references: [integrations.id],
	}),
	versions: many(planVersions),
	enrollments: many(enrollments),
	transactions: many(transactions),
}));

export const planVersionsRelations = relations(planVersions, ({ one }) => ({
	plan: one(plans, {
		fields: [planVersions.planId],
		references: [plans.id],
	}),
	creator: one(user, {
		fields: [planVersions.creatorId],
		references: [user.id],
	}),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
	user: one(user, {
		fields: [enrollments.userId],
		references: [user.id],
	}),
	plan: one(plans, {
		fields: [enrollments.planId],
		references: [plans.id],
	}),
	creator: one(user, {
		fields: [enrollments.creatorId],
		references: [user.id],
	}),
}));

export const transactionsRelations = relations(
	transactions,
	({ one, many }) => ({
		user: one(user, {
			fields: [transactions.userId],
			references: [user.id],
		}),
		creator: one(user, {
			fields: [transactions.creatorId],
			references: [user.id],
		}),
		plan: one(plans, {
			fields: [transactions.planId],
			references: [plans.id],
		}),
		planVersion: one(planVersions, {
			fields: [transactions.planVersionId],
			references: [planVersions.id],
		}),
		allocations: many(creditAllocations),
	}),
);

export const creditGrantsRelations = relations(
	creditGrants,
	({ one, many }) => ({
		enrollment: one(enrollments, {
			fields: [creditGrants.enrollmentId],
			references: [enrollments.id],
		}),
		plan: one(plans, {
			fields: [creditGrants.planId],
			references: [plans.id],
		}),
		allocations: many(creditAllocations),
	}),
);

export const creditAllocationsRelations = relations(
	creditAllocations,
	({ one }) => ({
		transaction: one(transactions, {
			fields: [creditAllocations.transactionId],
			references: [transactions.id],
		}),
		grant: one(creditGrants, {
			fields: [creditAllocations.grantId],
			references: [creditGrants.id],
		}),
	}),
);

export const invitesRelations = relations(invites, ({ one }) => ({
	creator: one(user, {
		fields: [invites.creatorId],

		references: [user.id],
	}),

	plan: one(plans, {
		fields: [invites.planId],

		references: [plans.id],
	}),
}));

export const calComAccountsRelations = relations(calComAccounts, ({ one }) => ({
	user: one(user, {
		fields: [calComAccounts.userId],
		references: [user.id],
	}),
}));

export const calcomIntegrationsRelations = relations(
	calcomIntegrations,
	({ one }) => ({
		integration: one(integrations, {
			fields: [calcomIntegrations.id],
			references: [integrations.calcomIntegrationId],
		}),
	}),
);

export const integrationsRelations = relations(
	integrations,
	({ one, many }) => ({
		user: one(user, {
			fields: [integrations.userId],
			references: [user.id],
		}),
		calcomIntegration: one(calcomIntegrations, {
			fields: [integrations.calcomIntegrationId],
			references: [calcomIntegrations.id],
		}),
		plans: many(plans),
	}),
);

export const paymentsRelations = relations(payments, ({ one, many }) => ({
	creator: one(user, {
		fields: [payments.creatorId],
		references: [user.id],
	}),
	customer: one(user, {
		fields: [payments.userId],
		references: [user.id],
	}),
	plan: one(plans, {
		fields: [payments.planId],
		references: [plans.id],
	}),
	planVersion: one(planVersions, {
		fields: [payments.planVersionId],
		references: [planVersions.id],
	}),
	refunds: many(refunds),
}));

export const refundsRelations = relations(refunds, ({ one }) => ({
	payment: one(payments, {
		fields: [refunds.paymentId],
		references: [payments.id],
	}),
	creator: one(user, {
		fields: [refunds.creatorId],
		references: [user.id],
	}),
	customer: one(user, {
		fields: [refunds.userId],
		references: [user.id],
	}),
}));

export const subscriptionsRelations = relations(
	subscriptions,
	({ one, many }) => ({
		creator: one(user, {
			fields: [subscriptions.creatorId],
			references: [user.id],
		}),
		customer: one(user, {
			fields: [subscriptions.userId],
			references: [user.id],
		}),
		plan: one(plans, {
			fields: [subscriptions.planId],
			references: [plans.id],
		}),
		planVersion: one(planVersions, {
			fields: [subscriptions.planVersionId],
			references: [planVersions.id],
		}),
		invoices: many(subscriptionInvoices),
	}),
);

export const subscriptionInvoicesRelations = relations(
	subscriptionInvoices,
	({ one }) => ({
		subscription: one(subscriptions, {
			fields: [subscriptionInvoices.subscriptionId],
			references: [subscriptions.id],
		}),
	}),
);

export const creatorCustomersRelations = relations(
	creatorCustomers,
	({ one }) => ({
		creator: one(user, {
			fields: [creatorCustomers.creatorId],
			references: [user.id],
		}),
		customer: one(user, {
			fields: [creatorCustomers.userId],
			references: [user.id],
		}),
	}),
);
