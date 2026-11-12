import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { enrollments, invites, transactions, user } from "@/app/db/schema";
import { appUrl } from "@/lib/app-url";
import { resolveCustomer } from "./customers";
import { pageInput, resolvePublishedPlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";
import { startPurchase } from "./purchase";

export const enrollmentInput = z.object({
	plan: z.string().trim().min(1),
	customer: z.string().trim().min(1),
	mode: z.enum(["invoice", "comp"]).default("invoice"),
	reason: z.string().trim().min(1).max(1000).optional(),
});

export async function enrollCustomer(principal: Principal, input: unknown) {
	requireScope(principal, "customers:write");
	const data = enrollmentInput.parse(input);
	if (data.mode === "comp" && !data.reason)
		throw new ServiceError(
			"INVALID_INPUT",
			"A reason is required for a complimentary enrollment",
		);
	// Both invitation and payment paths need sellable terms, so a draft can
	// never be smuggled into an enrollment by ID.
	const { plan, terms } = await resolvePublishedPlan(
		principal.creatorId,
		data.plan,
	);
	const email = data.customer.toLowerCase();
	// New enrollment is the only operation allowed to resolve an account that
	// is not yet this creator's customer. Do not expose the account profile.
	let knownCustomer: { id: string; email: string } | undefined;
	try {
		knownCustomer = await resolveCustomer(principal, data.customer);
	} catch (error) {
		if (!(error instanceof ServiceError) || error.code !== "NOT_FOUND")
			throw error;
	}
	const matches = knownCustomer
		? [knownCustomer]
		: await db
				.select({ id: user.id, email: user.email })
				.from(user)
				.where(
					sql`${user.id} = ${data.customer} or lower(${user.email}) = ${email}`,
				);
	if (matches.length > 1)
		throw new ServiceError(
			"AMBIGUOUS",
			"Use the customer's exact account ID",
			409,
		);
	const customer = matches[0];
	if (!customer) {
		if (!z.email().safeParse(email).success)
			throw new ServiceError(
				"NOT_FOUND",
				"Provide an email to invite a new customer",
				404,
			);
		return db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([principal.creatorId, email, plan.id])}, 0))`,
			);
			const existing = await tx.query.invites.findFirst({
				where: and(
					eq(invites.creatorId, principal.creatorId),
					eq(invites.email, email),
					eq(invites.planId, plan.id),
					eq(invites.status, "pending"),
					gt(invites.expiresAt, new Date()),
				),
			});
			const compCredits = data.mode === "comp" ? terms.credits : 0;
			if (
				existing &&
				(existing.compCredits !== compCredits ||
					existing.compReason !== (data.reason ?? null))
			)
				throw new ServiceError(
					"INVITE_CONFLICT",
					"A pending invite with different terms exists",
					409,
				);
			const invite =
				existing ??
				(
					await tx
						.insert(invites)
						.values({
							creatorId: principal.creatorId,
							email,
							planId: plan.id,
							token: crypto.randomUUID(),
							compCredits,
							compReason: data.reason,
						})
						.returning()
				)[0];
			return {
				status: "invited",
				inviteUrl: appUrl(`/invite/${invite.token}`),
				creditsOnClaim: compCredits,
				message: "No email was sent. Forward this link to the customer.",
			};
		});
	}
	if (data.mode === "comp") {
		return db.transaction(async (tx) => {
			const [enrollment] = await tx
				.insert(enrollments)
				.values({
					creatorId: principal.creatorId,
					userId: customer.id,
					planId: plan.id,
					credits: terms.credits,
				})
				.onConflictDoNothing()
				.returning();
			if (!enrollment)
				throw new ServiceError(
					"ALREADY_ENROLLED",
					"Already enrolled; use grant_credits for additional credits",
					409,
				);
			await tx.insert(transactions).values({
				creatorId: principal.creatorId,
				userId: customer.id,
				planId: plan.id,
				amount: terms.credits,
				type: "manual_adjustment",
				status: "completed",
				description: data.reason,
				balanceBefore: 0,
				balanceAfter: terms.credits,
			});
			return { status: "enrolled", enrollment };
		});
	}
	// Create the checkout before the enrollment. Stripe failures must not leave
	// an enrollment that the caller believes is payable but has no URL.
	const paymentUrl = await checkoutUrl(principal, customer.id, plan.id);
	await db
		.insert(enrollments)
		.values({
			creatorId: principal.creatorId,
			userId: customer.id,
			planId: plan.id,
		})
		.onConflictDoNothing();
	return {
		status: "awaiting_payment",
		paymentUrl,
		message:
			"Forward this checkout link. Credits are granted only after payment.",
	};
}

/**
 * Start the creator's Checkout for one enrolled customer.
 *
 * The shared purchase service owns the fee, the account-scoped Customer, the
 * receipt, and fulfillment rules, so this path cannot drift from self-service
 * buying. It must return a URL, because the caller's contract is "here is what
 * to forward".
 */
export async function checkoutUrl(
	principal: Principal,
	customerId: string,
	planId: string,
) {
	const result = await startPurchase(principal, {
		planId,
		userId: customerId,
	});
	if (!result.url)
		throw new ServiceError(
			"CHECKOUT_UNAVAILABLE",
			"No checkout URL was returned",
			502,
		);
	return result.url;
}

export async function listInvites(principal: Principal, input: unknown = {}) {
	requireScope(principal, "customers:read");
	return db.query.invites.findMany({
		where: eq(invites.creatorId, principal.creatorId),
		...pageInput.parse(input),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		with: { plan: true },
	});
}

export async function createInvite(principal: Principal, input: unknown) {
	requireScope(principal, "customers:write");
	const data = z
		.object({
			email: z.email().or(z.literal("")).optional(),
			planId: z.string().optional(),
		})
		.parse(input);
	if (data.planId) await resolvePublishedPlan(principal.creatorId, data.planId);
	if (data.email) {
		const existing = await db.query.invites.findFirst({
			where: and(
				eq(invites.creatorId, principal.creatorId),
				eq(invites.email, data.email.toLowerCase()),
				eq(invites.status, "pending"),
				gt(invites.expiresAt, new Date()),
			),
		});
		if (existing)
			throw new ServiceError("INVITE_EXISTS", "A pending invite exists", 409);
	}
	return (
		await db
			.insert(invites)
			.values({
				creatorId: principal.creatorId,
				email: data.email?.toLowerCase() || null,
				planId: data.planId,
				token: crypto.randomUUID(),
			})
			.returning()
	)[0];
}

export async function claimEnrollmentInvite(
	userId: string,
	email: string,
	token: string,
) {
	return db.transaction(async (tx) => {
		const [invite] = await tx
			.select()
			.from(invites)
			.where(and(eq(invites.token, token), eq(invites.status, "pending")))
			.for("update");
		if (
			!invite ||
			invite.expiresAt.getTime() <= Date.now() ||
			(invite.email && invite.email.toLowerCase() !== email.toLowerCase())
		)
			throw new ServiceError("NOT_FOUND", "Invite unavailable or expired", 404);
		if (invite.planId) {
			// An old invite must not resurrect a draft or unpublished offer.
			const { plan } = await resolvePublishedPlan(
				invite.creatorId,
				invite.planId,
				tx,
			);
			const [enrollment] = await tx
				.insert(enrollments)
				.values({
					creatorId: invite.creatorId,
					userId,
					planId: plan.id,
					credits: invite.compCredits,
				})
				.onConflictDoNothing()
				.returning();
			if (enrollment && invite.compCredits > 0)
				await tx.insert(transactions).values({
					creatorId: invite.creatorId,
					userId,
					planId: plan.id,
					amount: invite.compCredits,
					type: "manual_adjustment",
					status: "completed",
					description: invite.compReason ?? "Complimentary enrollment",
					balanceBefore: 0,
					balanceAfter: invite.compCredits,
				});
		}
		await tx
			.update(invites)
			.set({ status: "accepted", email })
			.where(eq(invites.id, invite.id));
		return { success: true };
	});
}
