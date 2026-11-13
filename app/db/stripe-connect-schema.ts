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
		/**
		 * True when the account was authorized through Connect OAuth rather than
		 * created by Litesubs. Only an OAuth authorization can be revoked through
		 * Stripe's deauthorize endpoint.
		 */
		authorizedViaOauth: boolean("authorized_via_oauth")
			.default(false)
			.notNull(),
		/** Mode of the authorization, so a test connection is never treated as live. */
		livemode: boolean("livemode"),
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
		/**
		 * Stripe's per-capability status. Direct charges need `card_payments`
		 * active, which is narrower than the aggregate `charges_enabled` flag.
		 */
		cardPaymentsStatus: text("card_payments_status"),
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
		/**
		 * Why the most recent disconnect attempt did not finish. A disconnect can
		 * fail after Stripe refuses a subscription update or after access was
		 * already revoked, so the state must stay visible and retryable instead
		 * of being reported as a clean disconnection.
		 */
		disconnectFailure: text("disconnect_failure"),
		disconnectAttemptedAt: timestamp("disconnect_attempted_at", {
			withTimezone: true,
		}),
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

/**
 * Single-use Connect OAuth state.
 *
 * The `state` value is only ever a hash: the raw value travels in the browser
 * URL, so a database dump must not be replayable. `consumedAt` makes a callback
 * work exactly once, and `userId` binds the callback to the creator who
 * started it so another signed-in user cannot finish it.
 */
export const connectOauthStates = pgTable(
	"connect_oauth_states",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		stateHash: text("state_hash").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		consumedAt: timestamp("consumed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("connect_oauth_state_user_idx").on(table.userId),
		index("connect_oauth_state_expiry_idx").on(table.expiresAt),
	],
);

// Relations

export const connectOauthStatesRelations = relations(
	connectOauthStates,
	({ one }) => ({
		user: one(user, {
			fields: [connectOauthStates.userId],
			references: [user.id],
		}),
	}),
);

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
export type ConnectOauthState = typeof connectOauthStates.$inferSelect;
export type AccountOnboardingMode =
	(typeof accountOnboardingModeEnum.enumValues)[number];
