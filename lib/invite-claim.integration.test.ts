/**
 * Invite claiming has three distinct failure modes that used to share one
 * message: "Invite unavailable or expired". A recipient could not tell "someone
 * else's invite" from "the creator withdrew it" from "it lapsed", so the only
 * actionable case — sign in with the invited address — looked broken.
 *
 * These run against the real service and database.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import { invites, user } from "@/app/db/schema";
import { claimEnrollmentInvite } from "@/lib/services/enroll";

test("invite claims distinguish expiry, wrong account, and a missing token", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);

	const creatorId = crypto.randomUUID();
	const invitedId = crypto.randomUUID();
	const invitectedEmail = `${invitedId}@example.test`;
	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: invitedId, name: "Invited", email: invitectedEmail },
	]);

	const makeInvite = async (overrides: Record<string, unknown> = {}) => {
		const [row] = await db
			.insert(invites)
			.values({
				creatorId,
				email: invitectedEmail,
				token: crypto.randomUUID(),
				...overrides,
			})
			.returning();
		return row;
	};

	try {
		await t.test(
			"a personalized invite refuses a different signed-in account",
			async () => {
				const invite = await makeInvite();
				await assert.rejects(
					claimEnrollmentInvite(
						invitedId,
						"someone-else@example.test",
						invite.token,
					),
					(error: { code?: string; message?: string }) => {
						assert.equal(error.code, "INVITE_WRONG_ACCOUNT");
						// The invitee's address must not leak to whoever holds the link.
						assert.doesNotMatch(
							error.message ?? "",
							new RegExp(invitectedEmail),
						);
						return true;
					},
				);
			},
		);

		await t.test("matching the invited address is accepted", async () => {
			const invite = await makeInvite();
			await claimEnrollmentInvite(invitedId, invitectedEmail, invite.token);
			const after = await db.query.invites.findFirst({
				where: eq(invites.id, invite.id),
			});
			assert.equal(after?.status, "accepted");
		});

		await t.test(
			"an expired invite says so, rather than 'unavailable'",
			async () => {
				const invite = await makeInvite({
					expiresAt: new Date(Date.now() - 1000),
				});
				await assert.rejects(
					claimEnrollmentInvite(invitedId, invitectedEmail, invite.token),
					{ code: "INVITE_EXPIRED" },
				);
			},
		);

		await t.test("an unknown token stays a plain not-found", async () => {
			await assert.rejects(
				claimEnrollmentInvite(invitedId, invitectedEmail, crypto.randomUUID()),
				{ code: "NOT_FOUND" },
			);
		});

		await t.test(
			"an already-claimed invite cannot be claimed twice",
			async () => {
				const invite = await makeInvite({ status: "accepted" });
				await assert.rejects(
					claimEnrollmentInvite(invitedId, invitectedEmail, invite.token),
					{ code: "NOT_FOUND" },
				);
			},
		);
	} finally {
		await db.delete(invites).where(eq(invites.creatorId, creatorId));
		await db.delete(user).where(eq(user.id, invitedId));
		await db.delete(user).where(eq(user.id, creatorId));
	}
});
