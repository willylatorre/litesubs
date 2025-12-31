import {
	boolean,
	decimal,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth-schema";

// Enums
export const payoutVerificationStatusEnum = pgEnum("payout_verification_status", [
	"pending",
	"verified",
	"failed",
]);

export const payoutStatusEnum = pgEnum("payout_status", [
	"pending",
	"processing",
	"completed",
	"failed",
	"cancelled",
]);

export const earningsTransactionTypeEnum = pgEnum("earnings_transaction_type", [
	"sale",
	"payout",
	"refund",
	"adjustment",
]);

// Tables

export const creatorPayoutAccounts = pgTable(
	"creator_payout_accounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: "cascade" }),
		verificationStatus: payoutVerificationStatusEnum(
			"verification_status",
		).default("pending").notNull(),
		stripeRecipientId: text("stripe_recipient_id"), // Connect Account ID acting as Recipient
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("payout_account_user_idx").on(table.userId)],
);

export const payouts = pgTable(
	"payouts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // Amount in dollars
		currency: text("currency").default("USD").notNull(),
		platformFee: decimal("platform_fee", { precision: 10, scale: 2 }).notNull(),
		netAmount: decimal("net_amount", { precision: 10, scale: 2 }).notNull(),
		status: payoutStatusEnum("status").default("pending").notNull(),
		stripePayoutId: text("stripe_payout_id"),
		stripeTransferId: text("stripe_transfer_id"),
		failureCode: text("failure_code"),
		failureMessage: text("failure_message"),
		requestedAt: timestamp("requested_at").defaultNow().notNull(),
		processedAt: timestamp("processed_at"),
		completedAt: timestamp("completed_at"),
		notes: text("notes"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("payouts_user_idx").on(table.userId),
		index("payouts_status_idx").on(table.status),
	],
);

export const earningsLedger = pgTable(
	"earnings_ledger",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		transactionType: earningsTransactionTypeEnum("transaction_type").notNull(),
		amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // Positive for earnings, negative for payouts
		currency: text("currency").default("USD").notNull(),
		relatedPaymentIntentId: text("related_payment_intent_id"),
		relatedPayoutId: text("related_payout_id").references(() => payouts.id, {
			onDelete: "set null",
		}),
		description: text("description"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("ledger_user_idx").on(table.userId),
		index("ledger_type_idx").on(table.transactionType),
	],
);

// Relations

export const creatorPayoutAccountsRelations = relations(
	creatorPayoutAccounts,
	({ one }) => ({
		user: one(user, {
			fields: [creatorPayoutAccounts.userId],
			references: [user.id],
		}),
	}),
);

export const payoutsRelations = relations(payouts, ({ one, many }) => ({
	user: one(user, {
		fields: [payouts.userId],
		references: [user.id],
	}),
	ledgerEntries: many(earningsLedger),
}));

export const earningsLedgerRelations = relations(earningsLedger, ({ one }) => ({
	user: one(user, {
		fields: [earningsLedger.userId],
		references: [user.id],
	}),
	payout: one(payouts, {
		fields: [earningsLedger.relatedPayoutId],
		references: [payouts.id],
	}),
}));
