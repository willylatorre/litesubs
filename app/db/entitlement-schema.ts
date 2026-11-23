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

/**
 * What a creator has paid for.
 *
 * Two tiers only. `free` is the default and needs no row; `premium` is backed
 * by a row in `litesub_subscription`.
 */
export const creatorTierEnum = pgEnum("creator_tier", ["free", "premium"]);

/** How many plans a tier may own. `null` means unlimited. */
export const FREE_PLAN_LIMIT = 2;

/**
 * liteSubs' own billing — the creator paying liteSubs.
 *
 * **This is not `subscriptions`.** That table is a creator's customer paying the
 * creator for credits, charged as a direct charge on the creator's connected
 * Stripe account. This one is the platform being paid on its *own* account, and
 * it is the only charge in the product that has no `event.account`.
 *
 * The physical table is `litesub_subscription` so the two are distinguishable at
 * a glance in psql and in Stripe logs. The Dart/TS export is `subscription`
 * because `@better-auth/stripe` looks its model up by that key — the adapter
 * resolves the export to the table object and reads the physical name from
 * `pgTable(...)`, so the alias costs no configuration.
 *
 * The columns are the plugin's declared schema, not a shape of our choosing.
 * Changing one is changing the plugin's contract, not a taste decision.
 */
export const subscription = pgTable(
	"litesub_subscription",
	{
		id: text("id").primaryKey(),
		/** The plugin's plan name; `premium` is the only one we configure. */
		plan: text("plan").notNull(),
		/** The creator this belongs to. The plugin defaults it to `user.id`. */
		referenceId: text("reference_id")
			.notNull()
			.unique()
			.references(() => user.id, { onDelete: "cascade" }),
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id").unique(),
		status: text("status").default("incomplete").notNull(),
		periodStart: timestamp("period_start", { withTimezone: true }),
		periodEnd: timestamp("period_end", { withTimezone: true }),
		trialStart: timestamp("trial_start", { withTimezone: true }),
		trialEnd: timestamp("trial_end", { withTimezone: true }),
		cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
		cancelAt: timestamp("cancel_at", { withTimezone: true }),
		canceledAt: timestamp("canceled_at", { withTimezone: true }),
		endedAt: timestamp("ended_at", { withTimezone: true }),
		seats: integer("seats"),
		billingInterval: text("billing_interval"),
		stripeScheduleId: text("stripe_schedule_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
			() => new Date(),
		),
	},
	(table) => [
		index("litesub_subscription_reference_idx").on(table.referenceId),
		index("litesub_subscription_customer_idx").on(table.stripeCustomerId),
	],
);

export const subscriptionRelations = relations(subscription, ({ one }) => ({
	creator: one(user, {
		fields: [subscription.referenceId],
		references: [user.id],
	}),
}));
