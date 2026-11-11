"use server";

import { and, eq, sum } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { enrollments, transactions } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { adjustCredits } from "@/lib/services/credits";
import {
	getCustomer,
	listCustomers,
	listTransactions,
} from "@/lib/services/customers";
import { ServiceError, sessionPrincipal } from "@/lib/services/principal";

export async function getCreatorCustomers() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await listCustomers(sessionPrincipal(session.user.id), {
			limit: 100,
		}),
	})).then((res) => res.data ?? []);
}

export async function getCustomerDetails(customerId: string) {
	return authenticatedAction(async (session) => {
		const principal = sessionPrincipal(session.user.id);
		const details = await getCustomer(principal, customerId);
		const [ledger, [spent]] = await Promise.all([
			listTransactions(principal, { customer: customerId, limit: 100 }),
			db
				.select({ value: sum(transactions.amountMoney) })
				.from(transactions)
				.where(
					and(
						eq(transactions.creatorId, session.user.id),
						eq(transactions.userId, details.customer.id),
						eq(transactions.type, "purchase"),
						eq(transactions.status, "completed"),
					),
				),
		]);
		return {
			success: true,
			data: {
				...details,
				transactions: ledger,
				totalSpent: Number(spent?.value ?? 0),
			},
		};
	});
}

export async function updateEnrollmentCredits(
	enrollmentId: string,
	amount: number,
	description: string,
) {
	return authenticatedAction(async (session) => {
		const enrollment = await db.query.enrollments.findFirst({
			where: and(
				eq(enrollments.id, enrollmentId),
				eq(enrollments.creatorId, session.user.id),
			),
		});
		if (!enrollment)
			throw new ServiceError("NOT_FOUND", "Enrollment not found", 404);
		await adjustCredits(sessionPrincipal(session.user.id), {
			customerId: enrollment.userId,
			planId: enrollment.planId,
			delta: amount,
			type: "manual_adjustment",
			reason: description || "Manual adjustment",
		});
		revalidatePath("/dashboard/customers");
		return { success: true };
	});
}

export async function updateCustomerCredits(
	userId: string,
	amount: number,
	description: string,
) {
	return authenticatedAction(async (session) => {
		const rows = await db.query.enrollments.findMany({
			where: and(
				eq(enrollments.userId, userId),
				eq(enrollments.creatorId, session.user.id),
			),
			limit: 2,
		});
		if (rows.length !== 1)
			throw new ServiceError(
				"AMBIGUOUS",
				"Choose a specific enrollment before adjusting credits",
				409,
			);
		await adjustCredits(sessionPrincipal(session.user.id), {
			customerId: userId,
			planId: rows[0].planId,
			delta: amount,
			type: "manual_adjustment",
			reason: description || "Manual adjustment",
		});
		revalidatePath("/dashboard/customers");
		return { success: true };
	});
}
