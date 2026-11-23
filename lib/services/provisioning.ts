import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { creatorCustomers, user } from "@/app/db/schema";
import { type Principal, requireScope, ServiceError } from "./principal";

/**
 * Teacher-initiated customer provisioning.
 *
 * ## Why this is not `enroll_customer`
 *
 * `enrollCustomer` is correct for self-serve: an unknown email gets an **invite**
 * and the learner signs up to claim it. That is the wrong shape for a teacher
 * setting up a class — they need the customer to exist *now*, so they can hand
 * out credits before the learner has ever logged in.
 *
 * ## What "exists" means safely
 *
 * The account is created **unclaimed**: a `user` row with the teacher's email and
 * no credential. Credits can be granted to it immediately because the ledger is
 * keyed by the enrollment, not by the learner being signed in. When the learner
 * later claims the invite, they set their own password and see their balance.
 *
 * No password is ever generated or emailed. An emailed default password is a
 * credential living in a mailbox, and the invite flow already proves the address
 * by requiring a claim.
 *
 * Idempotent per `(creator, email)`: calling twice returns the same customer, so
 * a retried enable or a double-click cannot fork one learner into two.
 */

const createCustomerSchema = z.object({
	email: z.email().max(320),
	name: z.string().trim().min(1).max(200).optional(),
});

export type ProvisionedCustomer = {
	customerId: string;
	email: string;
	/** True when this call created the account; false when it linked an existing one. */
	created: boolean;
	/** True when the account still needs the learner to claim it and set a password. */
	unclaimed: boolean;
};

/** A local part of the email, so a new account has a sensible display name. */
function fallbackName(email: string) {
	const local = email.split("@")[0] ?? "Customer";
	return local.replace(/[._-]+/g, " ").trim() || "Customer";
}

export async function provisionCustomer(
	principal: Principal,
	input: unknown,
): Promise<ProvisionedCustomer> {
	requireScope(principal, "customers:write");
	const data = createCustomerSchema.parse(input);
	const email = data.email.trim().toLowerCase();

	return db.transaction(async (tx) => {
		// Serialize on the email so two concurrent provisions cannot both decide
		// the account does not exist and create two rows.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["provision", principal.creatorId, email])}, 0))`,
		);

		const existingUser = await tx.query.user.findFirst({
			where: sql`lower(${user.email}) = ${email}`,
			columns: { id: true },
		});

		let customerId = existingUser?.id;
		let created = false;

		if (!customerId) {
			const [inserted] = await tx
				.insert(user)
				.values({
					id: crypto.randomUUID(),
					email,
					name: data.name ?? fallbackName(email),
					// Unclaimed: no credential exists, so nobody can sign in as them
					// until they claim the invite and choose a password.
					emailVerified: false,
				})
				.onConflictDoNothing({ target: user.email })
				.returning({ id: user.id });
			// A concurrent insert with the same email wins; re-read rather than fail.
			customerId =
				inserted?.id ??
				(
					await tx.query.user.findFirst({
						where: sql`lower(${user.email}) = ${email}`,
						columns: { id: true },
					})
				)?.id;
			created = Boolean(inserted);
		}

		if (!customerId)
			throw new ServiceError(
				"INVALID_INPUT",
				"Could not create or find that customer",
			);

		// Link them to this creator. A customer is per-creator, so the same person
		// can be a customer of several creators without sharing anything.
		const [link] = await tx
			.insert(creatorCustomers)
			.values({
				creatorId: principal.creatorId,
				userId: customerId,
				email,
				// No Stripe Customer yet: that is created on the connected account
				// at first purchase, never here.
				status: "ready",
			})
			.onConflictDoUpdate({
				target: [creatorCustomers.creatorId, creatorCustomers.userId],
				set: { email },
			})
			.returning({ id: creatorCustomers.id });

		if (!link)
			throw new ServiceError("INVALID_INPUT", "Could not link that customer");

		const account = await tx.query.user.findFirst({
			where: eq(user.id, customerId),
			columns: { emailVerified: true },
		});

		return {
			customerId,
			email,
			created,
			// "Unclaimed" is not a column: an account with no verified email and no
			// password cannot sign in yet, which is exactly what we mean.
			unclaimed: !account?.emailVerified,
		};
	});
}

/** Read back one provisioned customer, scoped to the calling creator. */
export async function getProvisionedCustomer(
	principal: Principal,
	customerId: string,
) {
	requireScope(principal, "customers:read");
	const [row] = await db
		.select({
			customerId: creatorCustomers.userId,
			email: creatorCustomers.email,
			createdAt: creatorCustomers.createdAt,
		})
		.from(creatorCustomers)
		.where(
			and(
				eq(creatorCustomers.creatorId, principal.creatorId),
				eq(creatorCustomers.userId, customerId),
			),
		)
		.limit(1);
	if (!row)
		throw new ServiceError("NOT_FOUND", "Customer not found", 404);
	return row;
}
