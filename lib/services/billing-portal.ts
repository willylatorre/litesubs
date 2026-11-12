import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/app/db";
import { creatorCustomers, enrollments, subscriptions } from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import { appUrl } from "@/lib/app-url";
import {
	createConnectedBillingPortalSession,
	ensureCustomerBillingPortalConfiguration,
} from "@/lib/stripe-billing-portal";
import { ServiceError } from "./principal";

export type BillingPortalAdapter = {
	ensureConfiguration: typeof ensureCustomerBillingPortalConfiguration;
	createSession: typeof createConnectedBillingPortalSession;
};

const defaultAdapter: BillingPortalAdapter = {
	ensureConfiguration: ensureCustomerBillingPortalConfiguration,
	createSession: createConnectedBillingPortalSession,
};

/** Create a short-lived portal URL for the authenticated customer's own subscription. */
export async function createCustomerBillingPortalSession(
	userId: string,
	subscriptionId: string,
	adapter: BillingPortalAdapter = defaultAdapter,
) {
	const subscription = await db.query.subscriptions.findFirst({
		where: and(
			eq(subscriptions.id, subscriptionId),
			eq(subscriptions.userId, userId),
		),
	});
	if (!subscription)
		throw new ServiceError("NOT_FOUND", "Subscription not found", 404);
	if (!subscription.stripeSubscriptionId)
		throw new ServiceError(
			"SUBSCRIPTION_NOT_READY",
			"Billing management is available after Stripe creates the subscription",
			409,
		);

	const [account, customer, enrollment] = await Promise.all([
		db.query.connectedAccounts.findFirst({
			where: and(
				eq(connectedAccounts.userId, subscription.creatorId),
				eq(connectedAccounts.stripeAccountId, subscription.stripeAccountId),
				isNull(connectedAccounts.disconnectedAt),
			),
			columns: { id: true },
		}),
		db.query.creatorCustomers.findFirst({
			where: and(
				eq(creatorCustomers.creatorId, subscription.creatorId),
				eq(creatorCustomers.userId, userId),
			),
			columns: {
				stripeAccountId: true,
				stripeCustomerId: true,
				status: true,
			},
		}),
		db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.creatorId, subscription.creatorId),
				eq(enrollments.userId, userId),
				eq(enrollments.planId, subscription.planId),
			),
			columns: { id: true },
		}),
	]);

	if (!account)
		throw new ServiceError(
			"ACCOUNT_UNAVAILABLE",
			"The creator's Stripe account is disconnected; billing management is unavailable",
			409,
		);
	if (!customer)
		throw new ServiceError(
			"CUSTOMER_MAPPING_MISMATCH",
			"The stored Stripe Customer does not match this subscription",
			409,
		);
	if (
		customer.status !== "ready" ||
		customer.stripeAccountId !== subscription.stripeAccountId ||
		customer.stripeCustomerId !== subscription.stripeCustomerId
	)
		throw new ServiceError(
			"CUSTOMER_MAPPING_MISMATCH",
			"The stored Stripe Customer does not match this subscription",
			409,
		);
	if (!enrollment)
		throw new ServiceError(
			"NOT_FOUND",
			"Subscription enrollment not found",
			404,
		);

	try {
		// Portal configurations are platform-level. The customer session itself is
		// created in the connected account that owns this Customer and subscription.
		const configuration = await adapter.ensureConfiguration();
		const session = await adapter.createSession({
			stripeAccountId: subscription.stripeAccountId,
			stripeCustomerId: subscription.stripeCustomerId,
			configurationId: configuration.id,
			returnUrl: appUrl(`/dashboard/enrollments/${enrollment.id}`),
		});
		if (!session.url || new URL(session.url).protocol !== "https:")
			throw new Error("Stripe did not return a secure portal URL");
		return { url: session.url };
	} catch {
		throw new ServiceError(
			"BILLING_PORTAL_UNAVAILABLE",
			"Could not open billing management. Try again or contact the creator.",
			502,
		);
	}
}
