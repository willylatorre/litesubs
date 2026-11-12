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
 * This is not recurring billing: Stripe subscriptions arrive in a later slice.
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
		// Stripe Connect fields
		usesStripeConnect: boolean("uses_stripe_connect").default(false),
		stripeApplicationFee: integer("stripe_application_fee"), // Platform fee in minor units
		stripeConnectAccountId: text("stripe_connect_account_id"), // Connected account ID
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
		token: text("token").notNull().unique(), // unique string for the link
		planId: text("plan_id").references(() => plans.id, {
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

export const transactionsRelations = relations(transactions, ({ one }) => ({
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
}));

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
