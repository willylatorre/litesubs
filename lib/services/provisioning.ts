import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { creatorCustomers, enrollments, user } from "@/app/db/schema";
import { resolvePublishedPlan } from "./plans";
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
 * ## The customer must be *visible* to the creator
 *
 * Writing only a `creator_customers` row is not enough. Every read path —
 * `resolveCustomer`, `GET /customers`, and therefore `credits/grant`,
 * `credits/consume` and `POST /enrollments` — resolves a customer through
 * **enrollments**. A provisioned learner with no enrollment was therefore
 * invisible: the caller got an ID it could not use, and the "provision them,
 * then hand out credits" flow the docs promise failed with `NOT_FOUND` until a
 * separate enrollment was created. `enrollments` is the creator's customer list,
 * so provisioning writes one.
 *
 * Idempotent per `(creator, email)`: calling twice returns the same customer, so
 * a retried enable or a double-click cannot fork one learner into two.
 */

const createCustomerSchema = z.object({
	email: z.email().max(320),
	name: z.string().trim().min(1).max(200).optional(),
	/**
	 * Optional plan to enroll the customer on immediately.
	 *
	 * Every credit operation is keyed by an enrollment, so naming a plan here is
	 * what turns "I created a person" into "I can grant them credits right now".
	 * Omitting it is still valid — the customer is then a known contact who can
	 * be enrolled later — but `credits/grant` will refuse until they are.
	 */
	plan: z.string().trim().min(1).optional(),
});

export type ProvisionedCustomer = {
	customerId: string;
	email: string;
	/** True when this call created the account; false when it linked an existing one. */
	created: boolean;
	/** True when the account still needs the learner to claim it and set a password. */
	unclaimed: boolean;
	/**
	 * The plan the customer was enrolled on, when the caller named one.
	 *
	 * A customer without an enrollment is a *person*, not yet a *buyer of a
	 * plan*, and every credit operation targets an enrollment. Provisioning with
	 * a `plan` therefore makes the customer immediately usable, which is the
	 * documented promise ("grant credits before they log in").
	 */
	planId?: string;
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

		// Enroll them when a plan is named. This is what makes the returned
		// customer immediately usable: credits target an enrollment, and
		// `resolveCustomer` reads the creator's customer list from enrollments.
		// The row starts at zero credits; a comp or purchase is a separate,
		// auditable ledger entry rather than a silent balance.
		let planId: string | undefined;
		if (data.plan) {
			const { plan } = await resolvePublishedPlan(
				principal.creatorId,
				data.plan,
			);
			planId = plan.id;
			await tx
				.insert(enrollments)
				.values({
					creatorId: principal.creatorId,
					userId: customerId,
					planId: plan.id,
				})
				.onConflictDoNothing();
		}

		const account = await tx.query.user.findFirst({
			where: eq(user.id, customerId),
			columns: { emailVerified: true },
		});

		return {
			customerId,
			email,
			created,
			planId,
			// "Unclaimed" is not a column: an account with no verified email and no
			// password cannot sign in yet, which is exactly what we mean.
			unclaimed: !account?.emailVerified,
		};
	});
}
