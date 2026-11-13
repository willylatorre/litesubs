"use server";

import {
	and,
	count,
	countDistinct,
	desc,
	eq,
	inArray,
	isNotNull,
	or,
} from "drizzle-orm";
import { db } from "@/app/db";
import { enrollments, invites, plans, subscriptions } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { usableBalance, usableBalances } from "@/lib/services/credits";
import { moneyByCurrency } from "@/lib/services/reporting";
import { isSubscriptionOverdue } from "@/lib/subscription-state";

export async function getUserEnrollmentDetails(enrollmentId: string) {
	return authenticatedAction(async (session) => {
		const enrollment = await db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.id, enrollmentId),
				eq(enrollments.userId, session.user.id),
			),
			with: {
				creator: true,
				plan: {
					with: {
						versions: {
							orderBy: (version, { desc }) => [desc(version.version)],
						},
						integration: {
							with: {
								calcomIntegration: true,
							},
						},
					},
				},
			},
		});

		if (!enrollment) {
			return { success: false, error: "Enrollment not found" };
		}
		const billingSubscription = await db.query.subscriptions.findFirst({
			where: and(
				eq(subscriptions.userId, session.user.id),
				eq(subscriptions.planId, enrollment.planId),
				or(
					inArray(subscriptions.status, [
						"pending",
						"incomplete",
						"active",
						"past_due",
					]),
					and(
						eq(subscriptions.status, "canceled"),
						isNotNull(subscriptions.stripeSubscriptionId),
					),
				),
			),
			orderBy: [desc(subscriptions.createdAt)],
			columns: {
				id: true,
				status: true,
				stripeSubscriptionId: true,
				paidThroughAt: true,
				cancelAtPeriodEnd: true,
				cancelAt: true,
				cancellationCause: true,
			},
			with: {
				planVersion: {
					columns: {
						billingMode: true,
						interval: true,
						currency: true,
						price: true,
						credits: true,
					},
				},
			},
		});
		const billingSubscriptionView = billingSubscription
			? (() => {
					const { stripeSubscriptionId, ...billingState } = billingSubscription;
					return {
						...billingState,
						canManageBilling: Boolean(stripeSubscriptionId),
						overdue: isSubscriptionOverdue(
							billingSubscription.status,
							billingSubscription.paidThroughAt,
						),
					};
				})()
			: null;

		return {
			success: true,
			data: {
				...enrollment,
				credits: await usableBalance(db, enrollment.id),
				money: await moneyByCurrency({
					kind: "customer",
					id: session.user.id,
					creatorId: enrollment.creatorId,
					planId: enrollment.planId,
				}),
				billingSubscription: billingSubscriptionView,
			},
		};
	});
}

export async function getDashboardData() {
	return authenticatedAction(async (session) => {
		const [statsResult, enrollmentResult, invitesResult, subscriptionsResult] =
			await Promise.all([
				// Consumer money comes from receipts, never credit-ledger rows.
				(async () => {
					const money = await moneyByCurrency({
						kind: "customer",
						id: session.user.id,
					});

					const [enrollmentCountResult] = await db
						.select({ count: count() })
						.from(enrollments)
						.where(eq(enrollments.userId, session.user.id));

					return {
						money,
						enrollmentCount: Number(enrollmentCountResult?.count || 0),
					};
				})(),

				// User enrollments
				db.query.enrollments.findMany({
					where: eq(enrollments.userId, session.user.id),
					with: {
						creator: true,
						plan: {
							with: {
								versions: {
									orderBy: (version, { desc }) => [desc(version.version)],
								},
								integration: {
									with: {
										calcomIntegration: true,
									},
								},
							},
						},
					},
				}),

				// Pending Invites
				db.query.invites.findMany({
					where: and(
						eq(invites.email, session.user.email),
						eq(invites.status, "pending"),
					),
					with: {
						creator: true,
						plan: {
							with: {
								versions: {
									orderBy: (version, { desc }) => [desc(version.version)],
								},
								integration: {
									with: {
										calcomIntegration: true,
									},
								},
							},
						},
					},
				}),

				db.query.subscriptions.findMany({
					where: and(
						eq(subscriptions.userId, session.user.id),
						or(
							inArray(subscriptions.status, [
								"pending",
								"incomplete",
								"active",
								"past_due",
							]),
							and(
								eq(subscriptions.status, "canceled"),
								isNotNull(subscriptions.stripeSubscriptionId),
							),
						),
					),
					orderBy: [desc(subscriptions.createdAt)],
					columns: {
						id: true,
						planId: true,
						status: true,
						stripeSubscriptionId: true,
						paidThroughAt: true,
						cancelAtPeriodEnd: true,
						cancelAt: true,
						cancellationCause: true,
					},
					with: {
						planVersion: {
							columns: {
								billingMode: true,
								interval: true,
								currency: true,
								price: true,
								credits: true,
							},
						},
					},
				}),
			]);

		const balances = await usableBalances(
			db,
			enrollmentResult.map((enrollment) => enrollment.id),
		);
		return {
			success: true,
			data: {
				stats: statsResult,
				enrollments: enrollmentResult.map((enrollment) => ({
					...enrollment,
					credits: balances.get(enrollment.id) ?? 0,
				})),
				pendingInvites: invitesResult,
				subscriptions: subscriptionsResult.map((subscription) => {
					const { stripeSubscriptionId, ...billingState } = subscription;
					return {
						...billingState,
						canManageBilling: Boolean(stripeSubscriptionId),
						overdue: isSubscriptionOverdue(
							subscription.status,
							subscription.paidThroughAt,
						),
					};
				}),
			},
		};
	}).then(
		(res) =>
			res.data || {
				stats: { money: [], enrollmentCount: 0 },
				enrollments: [],
				pendingInvites: [],
				subscriptions: [],
			},
	);
}

export async function getCreatorStats() {
	return authenticatedAction(async (session) => {
		// Receipts own the money definitions; plans/customers stay counts.
		const [money, [plansResult], [customersResult]] = await Promise.all([
			moneyByCurrency({ kind: "creator", id: session.user.id }),
			db
				.select({ count: count() })
				.from(plans)
				.where(eq(plans.creatorId, session.user.id)),
			db
				.select({ count: countDistinct(enrollments.userId) })
				.from(enrollments)
				.where(eq(enrollments.creatorId, session.user.id)),
		]);

		return {
			success: true,
			data: {
				money,
				totalPlans: Number(plansResult?.count || 0),
				totalCustomers: Number(customersResult?.count || 0),
			},
		};
	}).then(
		(res) =>
			res.data || {
				money: [],
				totalPlans: 0,
				totalCustomers: 0,
			},
	);
}

export async function getConsumerStats() {
	return authenticatedAction(async (session) => {
		const [money, [enrollmentsResult]] = await Promise.all([
			moneyByCurrency({ kind: "customer", id: session.user.id }),
			db
				.select({ count: count() })
				.from(enrollments)
				.where(eq(enrollments.userId, session.user.id)),
		]);

		return {
			success: true,
			data: {
				money,
				enrollmentCount: Number(enrollmentsResult?.count || 0),
			},
		};
	}).then(
		(res) =>
			res.data || {
				money: [],
				enrollmentCount: 0,
			},
	);
}

export async function getUserEnrollments() {
	return authenticatedAction(async (session) => {
		const [rows, billingSubscriptions] = await Promise.all([
			db.query.enrollments.findMany({
				where: eq(enrollments.userId, session.user.id),
				with: {
					creator: true,
					plan: {
						with: {
							versions: {
								orderBy: (version, { desc }) => [desc(version.version)],
							},
							integration: {
								with: {
									calcomIntegration: true,
								},
							},
						},
					},
				},
			}),
			db.query.subscriptions.findMany({
				where: and(
					eq(subscriptions.userId, session.user.id),
					or(
						inArray(subscriptions.status, [
							"pending",
							"incomplete",
							"active",
							"past_due",
						]),
						and(
							eq(subscriptions.status, "canceled"),
							isNotNull(subscriptions.stripeSubscriptionId),
						),
					),
				),
				orderBy: [desc(subscriptions.createdAt)],
				columns: {
					id: true,
					planId: true,
					status: true,
					stripeSubscriptionId: true,
					paidThroughAt: true,
					cancelAtPeriodEnd: true,
					cancelAt: true,
					cancellationCause: true,
				},
			}),
		]);
		const balances = await usableBalances(
			db,
			rows.map((row) => row.id),
		);
		const currentSubscriptions = new Map<
			string,
			(typeof billingSubscriptions)[number]
		>();
		for (const subscription of billingSubscriptions) {
			if (!currentSubscriptions.has(subscription.planId))
				currentSubscriptions.set(subscription.planId, subscription);
		}
		return {
			success: true,
			data: rows.map((row) => ({
				...row,
				credits: balances.get(row.id) ?? 0,
				billingSubscription: (() => {
					const subscription = currentSubscriptions.get(row.planId);
					if (!subscription) return null;
					const { stripeSubscriptionId, ...billingState } = subscription;
					return {
						...billingState,
						canManageBilling: Boolean(stripeSubscriptionId),
						overdue: isSubscriptionOverdue(
							subscription.status,
							subscription.paidThroughAt,
						),
					};
				})(),
			})),
		};
	}).then((res) => res.data || []);
}

/** Customer-owned Stripe billing identities for the Account page. */
export async function getUserBillingRelationships() {
	return authenticatedAction(async (session) => {
		const rows = await db.query.subscriptions.findMany({
			where: and(
				eq(subscriptions.userId, session.user.id),
				isNotNull(subscriptions.stripeSubscriptionId),
			),
			orderBy: [desc(subscriptions.createdAt)],
			columns: {
				id: true,
				status: true,
				paidThroughAt: true,
				cancelAtPeriodEnd: true,
				cancelAt: true,
				cancellationCause: true,
			},
			with: {
				creator: { columns: { name: true } },
				plan: { columns: { id: true, name: true } },
				planVersion: {
					columns: {
						billingMode: true,
						interval: true,
						currency: true,
						price: true,
						credits: true,
					},
				},
			},
		});
		return {
			success: true,
			data: rows.map((row) => ({
				...row,
				overdue: isSubscriptionOverdue(row.status, row.paidThroughAt),
			})),
		};
	}).then((result) => result.data ?? []);
}
