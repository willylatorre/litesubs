/**
 * An invite's `email` is a convenience, not an authorization gate: it exists so
 * the invite shows up in the dashboard of whoever registered with that address.
 * Holding a valid, unexpired link is what authorizes a claim, so any signed-in
 * account may accept — including one with a different address.
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

test("invite claims are authorized by the link, not the address", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);

	const creatorId = crypto.randomUUID();
	const invitedId = crypto.randomUUID();
	const invitedEmail = `${invitedId}@example.test`;
	const otherEmail = "someone-else@example.test";
	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: invitedId, name: "Invited", email: `${invitedId}@example.test` },
	]);

	const makeInvite = async (overrides: Record<string, unknown> = {}) => {
		const [row] = await db
			.insert(invites)
			.values({
				creatorId,
				email: invitedEmail,
				token: crypto.randomUUID(),
				...overrides,
			})
			.returning();
		return row;
	};

	try {
		await t.test(
			"a different signed-in address can accept the link",
			async () => {
				// The reported bug: accepting from another account was refused.
				const invite = await makeInvite();
				await claimEnrollmentInvite(invitedId, invite.token);
				const after = await db.query.invites.findFirst({
					where: eq(invites.id, invite.id),
				});
				assert.equal(after?.status, "accepted");
			},
		);

		await t.test(
			"accepting does not overwrite the address it was sent to",
			async () => {
				// The dashboard listing is keyed on this address, so replacing it with
				// the claimer's would hide the invite from the intended recipient.
				const invite = await makeInvite({ email: invitedEmail });
				await claimEnrollmentInvite(invitedId, invite.token);
				const after = await db.query.invites.findFirst({
					where: eq(invites.id, invite.id),
				});
				assert.equal(after?.email, invitedEmail);
			},
		);

		await t.test("an addressless invite is claimable by anyone", async () => {
			const invite = await makeInvite({ email: null });
			await claimEnrollmentInvite(invitedId, invite.token);
			const after = await db.query.invites.findFirst({
				where: eq(invites.id, invite.id),
			});
			assert.equal(after?.status, "accepted");
			// A shareable link keeps its null address rather than adopting a claimer.
			assert.equal(after?.email, null);
		});

		await t.test(
			"an expired invite still fails, with a real reason",
			async () => {
				const invite = await makeInvite({
					expiresAt: new Date(Date.now() - 1000),
				});
				await assert.rejects(
					claimEnrollmentInvite(invitedId, invite.token),
					{ code: "INVITE_EXPIRED" },
				);
			},
		);

		await t.test("an unknown token stays not-found", async () => {
			await assert.rejects(
				claimEnrollmentInvite(invitedId, crypto.randomUUID()),
				{ code: "NOT_FOUND" },
			);
		});

		await t.test(
			"an already-claimed invite cannot be claimed twice",
			async () => {
				const invite = await makeInvite({ status: "accepted" });
				await assert.rejects(
					claimEnrollmentInvite(invitedId, invite.token),
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
