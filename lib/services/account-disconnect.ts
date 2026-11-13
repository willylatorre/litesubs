import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/app/db";
import { subscriptions } from "@/app/db/schema";
import {
	type CancellationCause,
	type SubscriptionManagementAdapter,
	updateCustomerSubscriptionCancellation,
} from "./subscriptions";

/**
 * Disconnecting a Stripe account does not end subscriptions in Stripe.
 *
 * Litesubs therefore has to decide what happens to live subscriptions from its
 * own records, and say so plainly instead of quietly leaving them billing. The
 * policy is deliberately narrow:
 *
 * - Enumerate from Litesubs' records, never by scanning Stripe, so the count a
 *   creator is shown is the count we are accountable for.
 * - A disconnect with live subscriptions refuses until the creator explicitly
 *   chooses to stop renewals at each paid period.
 * - Stopping renewals reuses the customer cancel path, tagged with its cause, so
 *   there is only one mutation and support can tell the two apart.
 * - A paid period is never shortened: the entitlement boundary does not move.
 */

/** Statuses with a real Stripe subscription that can still bill the customer. */
const LIVE_STATUSES = ["incomplete", "active", "past_due"] as const;

export type LiveSubscription = {
	id: string;
	userId: string;
	planId: string;
	status: (typeof LIVE_STATUSES)[number];
	paidThroughAt: Date | null;
	cancelAtPeriodEnd: boolean;
	cancelAt: Date | null;
	cancellationCause: CancellationCause | null;
};

/** Live billing identities owned by this creator, from local records only. */
export async function listLiveSubscriptions(
	creatorId: string,
): Promise<LiveSubscription[]> {
	const rows = await db.query.subscriptions.findMany({
		where: and(
			eq(subscriptions.creatorId, creatorId),
			inArray(subscriptions.status, [...LIVE_STATUSES]),
		),
		orderBy: (table, { asc }) => [asc(table.createdAt)],
		columns: {
			id: true,
			userId: true,
			planId: true,
			status: true,
			paidThroughAt: true,
			cancelAtPeriodEnd: true,
			cancelAt: true,
			cancellationCause: true,
			stripeSubscriptionId: true,
		},
	});
	// A row that never reached Stripe is a pending Checkout, not a subscription
	// that can renew; it cannot be cancelled here and is not billed.
	return rows.flatMap(({ stripeSubscriptionId, ...row }) =>
		stripeSubscriptionId
			? [{ ...row, status: row.status as LiveSubscription["status"] }]
			: [],
	);
}

export type StopRenewalsResult = {
	/** Subscriptions whose renewals are (or already were) scheduled to stop. */
	stopped: string[];
	/** Subscriptions Stripe refused to update; the disconnect must not complete. */
	failed: { subscriptionId: string; userId: string; message: string }[];
};

/**
 * Schedule every live subscription to end at its paid period.
 *
 * Retry-safe: the cancel path reports `already_scheduled` without calling
 * Stripe, so repeating a partially failed disconnect only retries the failures.
 */
export async function stopLiveSubscriptions(
	creatorId: string,
	adapter?: SubscriptionManagementAdapter,
): Promise<StopRenewalsResult> {
	const live = await listLiveSubscriptions(creatorId);
	const stopped: string[] = [];
	const failed: StopRenewalsResult["failed"] = [];

	for (const subscription of live) {
		if (subscription.cancelAtPeriodEnd) {
			stopped.push(subscription.id);
			continue;
		}
		try {
			await updateCustomerSubscriptionCancellation(
				{
					userId: subscription.userId,
					subscriptionId: subscription.id,
					cancelAtPeriodEnd: true,
					cause: "creator_disconnect",
				},
				adapter,
			);
			stopped.push(subscription.id);
		} catch (error) {
			failed.push({
				subscriptionId: subscription.id,
				userId: subscription.userId,
				message:
					error instanceof Error
						? error.message
						: "Stripe did not accept the cancellation",
			});
		}
	}

	return { stopped, failed };
}
