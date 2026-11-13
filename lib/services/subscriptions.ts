import { and, eq, isNull, sql } from "drizzle-orm";
import type { Stripe } from "stripe";
import { db } from "@/app/db";
import { enrollments, subscriptions } from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { updateConnectedSubscription } from "@/lib/stripe-subscriptions";
import { ServiceError } from "./principal";

export type SubscriptionManagementAdapter = {
	update: typeof updateConnectedSubscription;
};

const stripeAdapter: SubscriptionManagementAdapter = {
	update: updateConnectedSubscription,
};

/** Why renewals stopped. A customer choice and a disconnect are not the same event. */
export type CancellationCause = "customer" | "creator_disconnect";

function stripeCustomerId(subscription: Stripe.Subscription) {
	return typeof subscription.customer === "string"
		? subscription.customer
		: subscription.customer.id;
}

/** Stripe's cancel_at_period_end is the effective date; item periods are fallback. */
export function cancellationEffectiveAt(subscription: Stripe.Subscription) {
	if (!subscription.cancel_at_period_end) return null;
	const periodEnd = Math.min(
		...subscription.items.data.map((item) => item.current_period_end),
	);
	const timestamp = subscription.cancel_at ?? periodEnd;
	return Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null;
}

function localStatus(
	stripeStatus: Stripe.Subscription.Status,
	currentStatus: (typeof subscriptions.$inferSelect)["status"],
): (typeof subscriptions.$inferSelect)["status"] {
	switch (stripeStatus) {
		case "active":
			return "active";
		case "past_due":
			return "past_due";
		case "incomplete":
			return "incomplete";
		case "canceled":
		case "unpaid":
		case "incomplete_expired":
			return "canceled";
		default:
			// Trials/pauses are not offered in v1. Preserve the last known state
			// instead of inventing an entitlement transition for an unknown status.
			return currentStatus;
	}
}

export async function updateCustomerSubscriptionCancellation(
	input: {
		userId: string;
		subscriptionId: string;
		cancelAtPeriodEnd: boolean;
		/**
		 * Defaults to the customer's own action. A creator disconnect uses the
		 * same Stripe mutation but records `creator_disconnect`, so a scheduled
		 * end is never mistaken for a customer choice.
		 */
		cause?: CancellationCause;
	},
	adapter: SubscriptionManagementAdapter = stripeAdapter,
) {
	const cause = input.cause ?? "customer";
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.userId, input.subscriptionId, "cancellation"])}, 0))`,
		);
		const [subscription] = await tx
			.select()
			.from(subscriptions)
			.where(
				and(
					eq(subscriptions.id, input.subscriptionId),
					eq(subscriptions.userId, input.userId),
				),
			)
			.for("update");
		if (!subscription)
			throw new ServiceError("NOT_FOUND", "Subscription not found", 404);
		if (subscription.status === "canceled")
			throw new ServiceError(
				"SUBSCRIPTION_ENDED",
				"This subscription has ended. Start a new subscription if the plan is still available.",
				409,
			);
		if (
			!subscription.stripeSubscriptionId ||
			(subscription.status !== "active" && subscription.status !== "past_due")
		)
			throw new ServiceError(
				"SUBSCRIPTION_NOT_ACTIVE",
				"The subscription is not ready to manage yet",
				409,
			);

		const enrollment = await tx.query.enrollments.findFirst({
			where: and(
				eq(enrollments.userId, subscription.userId),
				eq(enrollments.planId, subscription.planId),
			),
			columns: { id: true },
		});
		if (!enrollment)
			throw new ServiceError(
				"NOT_FOUND",
				"Subscription enrollment not found",
				404,
			);

		const account = await tx.query.connectedAccounts.findFirst({
			where: and(
				eq(connectedAccounts.userId, subscription.creatorId),
				eq(connectedAccounts.stripeAccountId, subscription.stripeAccountId),
				isNull(connectedAccounts.disconnectedAt),
			),
			columns: { id: true },
		});
		if (!account)
			throw new ServiceError(
				"ACCOUNT_UNAVAILABLE",
				"The creator's Stripe account is disconnected; subscription changes are unavailable",
				409,
			);

		if (subscription.cancelAtPeriodEnd === input.cancelAtPeriodEnd)
			return {
				status: input.cancelAtPeriodEnd
					? "already_scheduled"
					: "already_resumed",
				subscriptionId: subscription.id,
				enrollmentId: enrollment.id,
				stripeStatus: subscription.status,
				cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
				cancelAt: subscription.cancelAt,
				paidThroughAt: subscription.paidThroughAt,
				changed: false,
			};

		let updated: Stripe.Subscription;
		try {
			updated = await adapter.update({
				stripeAccountId: subscription.stripeAccountId,
				stripeSubscriptionId: subscription.stripeSubscriptionId,
				cancelAtPeriodEnd: input.cancelAtPeriodEnd,
				// Stable across retries after a lost response; the revision changes
				// after each successful state transition so cancel/resume can repeat.
				idempotencyKey: `litesubs:subscription:${subscription.id}:${subscription.cancellationRevision}:${input.cancelAtPeriodEnd ? "cancel" : "resume"}`,
			});
		} catch {
			throw new ServiceError(
				"SUBSCRIPTION_UPDATE_FAILED",
				"Stripe could not update this subscription. Your billing settings were not changed.",
				502,
			);
		}
		if (
			updated.id !== subscription.stripeSubscriptionId ||
			stripeCustomerId(updated) !== subscription.stripeCustomerId ||
			updated.cancel_at_period_end !== input.cancelAtPeriodEnd
		)
			throw new ServiceError(
				"SUBSCRIPTION_UPDATE_MISMATCH",
				"Stripe returned a different subscription state than requested",
				502,
			);

		const status = localStatus(updated.status, subscription.status);
		const cancelAt =
			cancellationEffectiveAt(updated) ??
			(input.cancelAtPeriodEnd ? subscription.paidThroughAt : null);
		await tx
			.update(subscriptions)
			.set({
				status,
				cancelAtPeriodEnd: updated.cancel_at_period_end,
				cancelAt,
				// Only a cancellation is attributed; resuming clears the attribution
				// so a later stop is not misreported as the earlier one.
				cancellationCause: input.cancelAtPeriodEnd ? cause : null,
				cancellationRevision: subscription.cancellationRevision + 1,
			})
			.where(eq(subscriptions.id, subscription.id));
		return {
			status: input.cancelAtPeriodEnd ? "scheduled" : "resumed",
			subscriptionId: subscription.id,
			enrollmentId: enrollment.id,
			stripeStatus: status,
			cancelAtPeriodEnd: updated.cancel_at_period_end,
			cancelAt,
			paidThroughAt: subscription.paidThroughAt,
			changed: true,
		};
	});
}

/** Mirror lifecycle state but never move the paid-through entitlement boundary. */
export async function syncSubscriptionFromStripe(input: {
	subscriptionId: string;
	stripeSubscriptionId: string;
	stripeAccountId: string;
	stripeCustomerId: string;
	stripeStatus: Stripe.Subscription.Status;
	cancelAtPeriodEnd: boolean;
	cancelAt: Date | null;
}) {
	return db.transaction(async (tx) => {
		const [subscription] = await tx
			.select()
			.from(subscriptions)
			.where(
				and(
					eq(subscriptions.id, input.subscriptionId),
					eq(subscriptions.stripeAccountId, input.stripeAccountId),
				),
			)
			.for("update");
		if (!subscription) return { handled: false as const };
		if (
			(subscription.stripeSubscriptionId &&
				subscription.stripeSubscriptionId !== input.stripeSubscriptionId) ||
			subscription.stripeCustomerId !== input.stripeCustomerId
		)
			throw new ServiceError(
				"SUBSCRIPTION_MISMATCH",
				"Stripe event does not match the stored subscription",
				409,
			);

		const flagChanged =
			subscription.cancelAtPeriodEnd !== input.cancelAtPeriodEnd;
		const status = localStatus(input.stripeStatus, subscription.status);
		await tx
			.update(subscriptions)
			.set({
				stripeSubscriptionId: input.stripeSubscriptionId,
				status,
				cancelAtPeriodEnd: input.cancelAtPeriodEnd,
				cancelAt: input.cancelAt,
				...(flagChanged
					? { cancellationRevision: subscription.cancellationRevision + 1 }
					: {}),
			})
			.where(eq(subscriptions.id, subscription.id));
		return { handled: true as const };
	});
}
