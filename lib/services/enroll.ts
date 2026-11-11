import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import {
	invites,
	liteSubscriptions,
	products,
	stripeConnectAccounts,
	transactions,
	user,
} from "@/app/db/schema";
import { appUrl } from "@/lib/app-url";
import { PLATFORM_FEE_PERCENT } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { resolveCustomer } from "./customers";
import { pageInput, resolvePlan } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";

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
	const plan = await resolvePlan(principal, data.plan);
	if (!plan.active)
		throw new ServiceError("INACTIVE_PLAN", "This plan is unavailable", 409);
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
					eq(invites.productId, plan.id),
					eq(invites.status, "pending"),
					gt(invites.expiresAt, new Date()),
				),
			});
			const compCredits = data.mode === "comp" ? plan.credits : 0;
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
							productId: plan.id,
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
			const [sub] = await tx
				.insert(liteSubscriptions)
				.values({
					creatorId: principal.creatorId,
					userId: customer.id,
					productId: plan.id,
					credits: plan.credits,
				})
				.onConflictDoNothing()
				.returning();
			if (!sub)
				throw new ServiceError(
					"ALREADY_ENROLLED",
					"Already enrolled; use grant_credits for additional credits",
					409,
				);
			await tx.insert(transactions).values({
				creatorId: principal.creatorId,
				userId: customer.id,
				productId: plan.id,
				amount: plan.credits,
				type: "manual_adjustment",
				status: "completed",
				description: data.reason,
				balanceBefore: 0,
				balanceAfter: plan.credits,
			});
			return { status: "enrolled", enrollment: sub };
		});
	}
	// Create the checkout before the enrollment. Stripe failures must not leave
	// an enrollment that the caller believes is payable but has no URL.
	const paymentUrl = await checkoutUrl(principal, customer.id, plan.id);
	await db
		.insert(liteSubscriptions)
		.values({
			creatorId: principal.creatorId,
			userId: customer.id,
			productId: plan.id,
		})
		.onConflictDoNothing();
	return {
		status: "awaiting_payment",
		paymentUrl,
		message:
			"Forward this checkout link. Credits are granted only after payment.",
	};
}

export async function checkoutUrl(
	principal: Principal,
	customerId: string,
	planId: string,
) {
	requireScope(principal, "customers:write");
	const plan = await resolvePlan(principal, planId);
	if (!plan.active)
		throw new ServiceError("INACTIVE_PLAN", "This plan is unavailable", 409);
	const [customer, connect] = await Promise.all([
		db.query.user.findFirst({ where: eq(user.id, customerId) }),
		db.query.stripeConnectAccounts.findFirst({
			where: eq(stripeConnectAccounts.userId, principal.creatorId),
		}),
	]);
	if (!customer) throw new ServiceError("NOT_FOUND", "Customer not found", 404);
	const connected =
		connect?.chargesEnabled && connect.status === "active" ? connect : null;
	const fee = connected
		? Math.round(plan.price * PLATFORM_FEE_PERCENT)
		: undefined;
	const session = await getStripe().checkout.sessions.create({
		mode: "payment",
		integration_identifier: `litesubs_mcp_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => String.fromCharCode(97 + (n % 26))).join("")}`,
		line_items: [
			{
				price_data: {
					currency: plan.currency,
					product_data: { name: plan.name },
					unit_amount: plan.price,
				},
				quantity: 1,
			},
		],
		customer_email: customer.email,
		success_url: appUrl(`/dashboard?success=true&productId=${plan.id}`),
		cancel_url: appUrl("/dashboard?canceled=true"),
		metadata: {
			userId: customerId,
			productId: plan.id,
			creatorId: principal.creatorId,
			credits: String(plan.credits),
			type: "credit_purchase",
			usesStripeConnect: String(!!connected),
			stripeConnectAccountId: connected?.stripeAccountId ?? "",
			applicationFeeAmount: fee?.toString() ?? "",
		},
		...(connected
			? {
					payment_intent_data: {
						application_fee_amount: fee,
						transfer_data: { destination: connected.stripeAccountId },
					},
				}
			: {}),
	});
	if (!session.url)
		throw new ServiceError(
			"CHECKOUT_UNAVAILABLE",
			"No checkout URL was returned",
			502,
		);
	return session.url;
}

export async function listInvites(principal: Principal, input: unknown = {}) {
	requireScope(principal, "customers:read");
	return db.query.invites.findMany({
		where: eq(invites.creatorId, principal.creatorId),
		...pageInput.parse(input),
		orderBy: (table, { desc }) => [desc(table.createdAt)],
		with: { product: true },
	});
}

export async function createInvite(principal: Principal, input: unknown) {
	requireScope(principal, "customers:write");
	const data = z
		.object({
			email: z.email().or(z.literal("")).optional(),
			productId: z.string().optional(),
		})
		.parse(input);
	if (data.productId) await resolvePlan(principal, data.productId);
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
				productId: data.productId,
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
		if (invite.productId) {
			const plan = await tx.query.products.findFirst({
				where: and(
					eq(products.id, invite.productId),
					eq(products.creatorId, invite.creatorId),
					eq(products.active, true),
				),
			});
			if (!plan)
				throw new ServiceError("NOT_FOUND", "Invited plan is unavailable", 404);
			const [sub] = await tx
				.insert(liteSubscriptions)
				.values({
					creatorId: invite.creatorId,
					userId,
					productId: invite.productId,
					credits: invite.compCredits,
				})
				.onConflictDoNothing()
				.returning();
			if (sub && invite.compCredits > 0)
				await tx.insert(transactions).values({
					creatorId: invite.creatorId,
					userId,
					productId: invite.productId,
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
