import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Enums
export const stripeConnectStatusEnum = pgEnum("stripe_connect_status", [
	"pending",
	"active",
	"restricted",
	"disabled",
]);

export const payoutMethodEnum = pgEnum("payout_method", [
	"stripe_connect",
	"platform_payouts",
]);

// Tables

/**
 * Stores Stripe Connect account information for creators
 * who choose to receive payments directly to their Stripe account
 */
export const stripeConnectAccounts = pgTable(
	"stripe_connect_accounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: "cascade" }),
		stripeAccountId: text("stripe_account_id").notNull().unique(), // acct_xxx
		accountType: text("account_type").default("express").notNull(), // 'express', 'standard'
		status: stripeConnectStatusEnum("status").default("pending").notNull(),
		chargesEnabled: boolean("charges_enabled").default(false).notNull(),
		payoutsEnabled: boolean("payouts_enabled").default(false).notNull(),
		detailsSubmitted: boolean("details_submitted").default(false).notNull(),
		country: text("country"),
		defaultCurrency: text("default_currency"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("stripe_connect_user_idx").on(table.userId),
		index("stripe_connect_account_idx").on(table.stripeAccountId),
	],
);

/**
 * Stores user's preference for payout method
 * Either 'stripe_connect' (direct payments) or 'platform_payouts' (manual payouts)
 */
export const userPayoutPreferences = pgTable(
	"user_payout_preferences",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: "cascade" }),
		method: payoutMethodEnum("method").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("payout_pref_user_idx").on(table.userId)],
);

// Relations

export const stripeConnectAccountsRelations = relations(
	stripeConnectAccounts,
	({ one }) => ({
		user: one(user, {
			fields: [stripeConnectAccounts.userId],
			references: [user.id],
		}),
	}),
);

export const userPayoutPreferencesRelations = relations(
	userPayoutPreferences,
	({ one }) => ({
		user: one(user, {
			fields: [userPayoutPreferences.userId],
			references: [user.id],
		}),
	}),
);

// Types for use in application code
export type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;
export type NewStripeConnectAccount = typeof stripeConnectAccounts.$inferInsert;
export type StripeConnectStatus = (typeof stripeConnectStatusEnum.enumValues)[number];

export type UserPayoutPreference = typeof userPayoutPreferences.$inferSelect;
export type NewUserPayoutPreference = typeof userPayoutPreferences.$inferInsert;
export type PayoutMethod = (typeof payoutMethodEnum.enumValues)[number];
