import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { enrollments, invites, transactions, user } from "@/app/db/schema";
import { appUrl } from "@/lib/app-url";
import {
	currentPaidThrough,
	grantCredits,
	resolveGrantExpiry,
} from "./credits";
import { resolveCustomer } from "./customers";
import { pageInput, resolvePublishedPlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";
import { startPurchase, startSubscription } from "./purchase";

export const enrollmentInput = z.object({
	plan: z.string().trim().min(1),
	customer: z.string().trim().min(1),
	mode: z.enum(["invoice", "comp"]).default("invoice"),
	reason: z.string().trim().min(1).max(1000).optional(),
	/**
	 * ISO-8601 string: required for a complimentary recurring plan with no
	 * current paid period. A Date is not expressible as MCP input JSON Schema.
	 */
	expires_at: z.iso.datetime().optional(),
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
		// An invite has no enrollment yet, so it cannot inherit a paid period.
		// A recurring comp must therefore state its expiry when it is issued.
		if (data.mode === "comp" && terms.billingMode === "recurring") {
			if (!data.expires_at)
				throw new ServiceError(
					"EXPIRY_REQUIRED",
					"A complimentary monthly invite needs an explicit expiry date",
					409,
				);
			if (new Date(data.expires_at).getTime() <= Date.now())
				throw new ServiceError(
					"INVALID_INPUT",
					"A credit expiry must be in the future",
				);
		}
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
			const compExpiresAt =
				data.mode === "comp" && data.expires_at
					? new Date(data.expires_at)
					: null;
			if (
				existing &&
				(existing.compCredits !== compCredits ||
					existing.compReason !== (data.reason ?? null) ||
					existing.planVersionId !== terms.id ||
					existing.compExpiresAt?.getTime() !== compExpiresAt?.getTime())
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
							planVersionId: terms.id,
							token: crypto.randomUUID(),
							compCredits,
							compReason: data.reason,
							compExpiresAt,
						})
						.returning()
				)[0];
			return {
				status: "invited",
				inviteUrl: appUrl(`/invite/${invite.token}`),
				creditsOnClaim: compCredits,
				creditsExpireAt: compExpiresAt,
				message: "No email was sent. Forward this link to the customer.",
			};
		});
	}
	if (data.mode === "comp") {
		return db.transaction(async (tx) => {
			// The balance starts at zero; the comp is then a real grant, so every
			// credit has a source and an explicit or inherited expiry.
			const [enrollment] = await tx
				.insert(enrollments)
				.values({
					creatorId: principal.creatorId,
					userId: customer.id,
					planId: plan.id,
				})
				.onConflictDoNothing()
				.returning();
			if (!enrollment)
				throw new ServiceError(
					"ALREADY_ENROLLED",
					"Already enrolled; use grant_credits for additional credits",
					409,
				);
			const expiresAt = await resolveGrantExpiry(tx, {
				creatorId: principal.creatorId,
				userId: customer.id,
				planId: plan.id,
				expiresAt: data.expires_at ? new Date(data.expires_at) : null,
			});
			const [entry] = await tx
				.insert(transactions)
				.values({
					creatorId: principal.creatorId,
					userId: customer.id,
					planId: plan.id,
					planVersionId: terms.id,
					amount: terms.credits,
					type: "manual_adjustment",
					status: "completed",
					description: data.reason,
					balanceBefore: 0,
					balanceAfter: terms.credits,
				})
				.returning({ id: transactions.id });
			await grantCredits(tx, {
				enrollmentId: enrollment.id,
				creatorId: principal.creatorId,
				userId: customer.id,
				planId: plan.id,
				planVersionId: terms.id,
				sourceTransactionId: entry.id,
				kind: "comp",
				amount: terms.credits,
				expiresAt,
			});
			return { status: "enrolled", enrollment, creditsExpireAt: expiresAt };
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
	const { terms } = await resolvePublishedPlan(principal.creatorId, planId);
	const start =
		terms.billingMode === "recurring" ? startSubscription : startPurchase;
	const result = await start(principal, {
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
	const published = data.planId
		? await resolvePublishedPlan(principal.creatorId, data.planId)
		: undefined;
	return (
		await db
			.insert(invites)
			.values({
				creatorId: principal.creatorId,
				email: data.email?.toLowerCase() || null,
				planId: data.planId,
				// Record the offer shown at issue time so a later draft edit cannot
				// change what the claim actually grants.
				planVersionId: published?.terms.id,
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
			// An old invite must not resurrect a draft, unpublished, or superseded
			// offer. It also must not silently apply newer terms than it promised.
			const { plan, terms } = await resolvePublishedPlan(
				invite.creatorId,
				invite.planId,
				tx,
			);
			if (invite.planVersionId && invite.planVersionId !== terms.id)
				throw new ServiceError(
					"INVITE_OUTDATED",
					"These plan terms changed after the invite was issued. Ask the creator for a new invite.",
					409,
				);
			const [enrollment] = await tx
				.insert(enrollments)
				.values({
					creatorId: invite.creatorId,
					userId,
					planId: plan.id,
				})
				.onConflictDoNothing()
				.returning();
			if (enrollment && invite.compCredits > 0) {
				// The invite's stated expiry is what was promised. A paid period that
				// began after issue can only shorten it, never extend it.
				if (
					invite.compExpiresAt &&
					invite.compExpiresAt.getTime() <= Date.now()
				)
					throw new ServiceError(
						"INVITE_EXPIRED",
						"This complimentary invite's credits were valid until a date that has passed",
						409,
					);
				const paidThrough = await currentPaidThrough(tx, {
					creatorId: invite.creatorId,
					userId,
					planId: plan.id,
				});
				const expiresAt = invite.compExpiresAt
					? paidThrough
						? new Date(
								Math.min(invite.compExpiresAt.getTime(), paidThrough.getTime()),
							)
						: invite.compExpiresAt
					: await resolveGrantExpiry(tx, {
							creatorId: invite.creatorId,
							userId,
							planId: plan.id,
						});
				const [entry] = await tx
					.insert(transactions)
					.values({
						creatorId: invite.creatorId,
						userId,
						planId: plan.id,
						planVersionId: terms.id,
						amount: invite.compCredits,
						type: "manual_adjustment",
						status: "completed",
						description: invite.compReason ?? "Complimentary enrollment",
						balanceBefore: 0,
						balanceAfter: invite.compCredits,
					})
					.returning({ id: transactions.id });
				await grantCredits(tx, {
					enrollmentId: enrollment.id,
					creatorId: invite.creatorId,
					userId,
					planId: plan.id,
					planVersionId: terms.id,
					sourceTransactionId: entry.id,
					kind: "comp",
					amount: invite.compCredits,
					expiresAt,
				});
			}
		}
		await tx
			.update(invites)
			.set({ status: "accepted", email, planVersionId: invite.planVersionId })
			.where(eq(invites.id, invite.id));
		return { success: true };
	});
}
