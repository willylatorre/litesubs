"use server";

import { and, count, countDistinct, eq, sum } from "drizzle-orm";
import { db } from "@/app/db";
import { enrollments, invites, plans, transactions } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";

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

		return { success: true, data: enrollment };
	});
}

export async function getDashboardData() {
	return authenticatedAction(async (session) => {
		const [statsResult, enrollmentResult, invitesResult] = await Promise.all([
			// Consumer Stats
			(async () => {
				const [spentResult] = await db
					.select({ value: sum(transactions.amountMoney) })
					.from(transactions)
					.where(
						and(
							eq(transactions.userId, session.user.id),
							eq(transactions.type, "purchase"),
							eq(transactions.status, "completed"),
						),
					);

				const [enrollmentCountResult] = await db
					.select({ count: count() })
					.from(enrollments)
					.where(eq(enrollments.userId, session.user.id));

				return {
					totalSpent: Number(spentResult?.value || 0),
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
		]);

		return {
			success: true,
			data: {
				stats: statsResult,
				enrollments: enrollmentResult,
				pendingInvites: invitesResult,
			},
		};
	}).then(
		(res) =>
			res.data || {
				stats: { totalSpent: 0, enrollmentCount: 0 },
				enrollments: [],
				pendingInvites: [],
			},
	);
}

export async function getCreatorStats() {
	return authenticatedAction(async (session) => {
		// Run all independent queries in parallel for ~3x faster response
		const [[revenueResult], [plansResult], [customersResult]] =
			await Promise.all([
				db
					.select({ value: sum(transactions.amountMoney) })
					.from(transactions)
					.where(
						and(
							eq(transactions.creatorId, session.user.id),
							eq(transactions.type, "purchase"),
							eq(transactions.status, "completed"),
						),
					),
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
				totalRevenue: Number(revenueResult?.value || 0),
				totalPlans: Number(plansResult?.count || 0),
				totalCustomers: Number(customersResult?.count || 0),
			},
		};
	}).then(
		(res) =>
			res.data || {
				totalRevenue: 0,
				totalPlans: 0,
				totalCustomers: 0,
			},
	);
}

export async function getConsumerStats() {
	return authenticatedAction(async (session) => {
		const [spentResult] = await db
			.select({ value: sum(transactions.amountMoney) })
			.from(transactions)
			.where(
				and(
					eq(transactions.userId, session.user.id),
					eq(transactions.type, "purchase"),
					eq(transactions.status, "completed"),
				),
			);

		const [enrollmentsResult] = await db
			.select({ count: count() })
			.from(enrollments)
			.where(eq(enrollments.userId, session.user.id));

		return {
			success: true,
			data: {
				totalSpent: Number(spentResult?.value || 0),
				enrollmentCount: Number(enrollmentsResult?.count || 0),
			},
		};
	}).then(
		(res) =>
			res.data || {
				totalSpent: 0,
				enrollmentCount: 0,
			},
	);
}

export async function getUserEnrollments() {
	return authenticatedAction(async (session) => {
		const rows = await db.query.enrollments.findMany({
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
		});

		return { success: true, data: rows };
	}).then((res) => res.data || []);
}
