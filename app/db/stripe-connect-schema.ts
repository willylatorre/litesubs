import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Enums

/**
 * Local readiness summary. It is derived from Stripe's reported capabilities
 * and requirements, never assumed from "an account row exists".
 */
export const accountStatusEnum = pgEnum("account_status", [
	"pending",
	"active",
	"restricted",
	"disabled",
]);

/**
 * How the connected account was obtained. New-account creation and
 * existing-account connection are different supported mechanisms.
 */
export const accountOnboardingModeEnum = pgEnum("account_onboarding_mode", [
	"created",
	"connected",
]);

// Tables

/**
 * A creator's own Stripe account. Litesubs acts on it as a Connect platform:
 * the account owns its Dashboard, pays Stripe's processing fees, and is
 * responsible for its own negative balances. Those responsibilities are stored
 * explicitly because they are an agreement, not a guess from an account type.
 */
export const connectedAccounts = pgTable(
	"connected_accounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: "cascade" }),
		stripeAccountId: text("stripe_account_id").notNull().unique(),
		onboardingMode: accountOnboardingModeEnum("onboarding_mode").notNull(),
		status: accountStatusEnum("status").default("pending").notNull(),
		// Agreed responsibility configuration, as requested at creation time.
		controllerType: text("controller_type"),
		dashboardType: text("dashboard_type"),
		feesPayer: text("fees_payer"),
		lossesPayments: text("losses_payments"),
		// Stripe-reported capability state. `chargesEnabled` is the merchant
		// capability that new sales require; payouts are the creator's business.
		chargesEnabled: boolean("charges_enabled").default(false).notNull(),
		payoutsEnabled: boolean("payouts_enabled").default(false).notNull(),
		detailsSubmitted: boolean("details_submitted").default(false).notNull(),
		country: text("country"),
		defaultCurrency: text("default_currency"),
		// Requirement field names only; never account holder PII.
		requirementsCurrentlyDue: jsonb("requirements_currently_due")
			.$type<string[]>()
			.default([])
			.notNull(),
		requirementsDisabledReason: text("requirements_disabled_reason"),
		lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
		disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("connected_account_user_idx").on(table.userId),
		index("connected_account_stripe_idx").on(table.stripeAccountId),
	],
);

// Relations

export const connectedAccountsRelations = relations(
	connectedAccounts,
	({ one }) => ({
		user: one(user, {
			fields: [connectedAccounts.userId],
			references: [user.id],
		}),
	}),
);

// Types for application code
export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type NewConnectedAccount = typeof connectedAccounts.$inferInsert;
export type AccountStatus = (typeof accountStatusEnum.enumValues)[number];
export type AccountOnboardingMode =
	(typeof accountOnboardingModeEnum.enumValues)[number];
