"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { invites, userBalances } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import { createInviteSchema } from "@/lib/schemas";

export async function createInvite(prevState: any, formData: FormData) {
	return authenticatedAction(async (session) => {
		const email = formData.get("email");
		const productId = formData.get("productId");

		const validated = createInviteSchema.safeParse({
			email,
			productId: productId === "undefined" ? undefined : productId,
		});

		if (!validated.success) {
			return { error: "Invalid email" };
		}

		if (validated.data.email) {
			const existingInvite = await db.query.invites.findFirst({
				where: and(
					eq(invites.creatorId, session.user.id),
					eq(invites.email, validated.data.email),
					eq(invites.status, "pending"),
				),
			});

			if (existingInvite) {
				return { error: "Pending invite already exists for this email." };
			}
		}

		const token = crypto.randomUUID();

		await db.insert(invites).values({
			creatorId: session.user.id,
			email: validated.data.email || null,
			token,
			status: "pending",
			productId: validated.data.productId || null,
		});

		revalidatePath("/dashboard/creator");
		return { success: true, message: "Invite sent!", token }; // Return token for UI if needed
	});
}

export async function getCreatorInvites() {
	return authenticatedAction(async (session) => {
		const data = await db.query.invites.findMany({
			where: eq(invites.creatorId, session.user.id),
			orderBy: (invites, { desc }) => [desc(invites.createdAt)],
		});
		return { success: true, data };
	}).then((res) => res.data || []);
}

export async function getUserPendingInvites() {
	return authenticatedAction(async (session) => {
		const data = await db.query.invites.findMany({
			where: and(
				eq(invites.email, session.user.email),
				eq(invites.status, "pending"),
			),
			with: {
				creator: true,
				product: true,
			},
		});
		return { success: true, data };
	}).then((res) => res.data || []);
}

export async function claimInvite(token: string) {
	return authenticatedAction(async (session) => {
		const invite = await db.query.invites.findFirst({
			where: and(eq(invites.token, token), eq(invites.status, "pending")),
		});

		if (!invite) return { error: "Invite not found" };

		// If invite has email, check if it matches
		if (invite.email && invite.email !== session.user.email) {
			return { error: "This invite is for another user" };
		}

		await db.transaction(async (tx) => {
			// Update invite status and ensure email is set
			await tx
				.update(invites)
				.set({
					email: session.user.email,
					status: "accepted",
				})
				.where(eq(invites.id, invite.id));

			// Create user balance if not exists
			await tx
				.insert(userBalances)
				.values({
					userId: session.user.id,
					creatorId: invite.creatorId,
					credits: 0,
				})
				.onConflictDoNothing();
		});

		revalidatePath("/dashboard/subscriptions");
		revalidatePath("/dashboard");

		return { success: true };
	});
}

export async function respondToInvite(inviteId: string, accept: boolean) {
	return authenticatedAction(async (session) => {
		const invite = await db.query.invites.findFirst({
			where: and(
				eq(invites.id, inviteId),
				eq(invites.email, session.user.email),
				eq(invites.status, "pending"),
			),
		});

		if (!invite) {
			return { error: "Invite not found or invalid" };
		}

		await db.transaction(async (tx) => {
			// Update invite status
			await tx
				.update(invites)
				.set({ status: accept ? "accepted" : "rejected" })
				.where(eq(invites.id, inviteId));

			if (accept) {
				// Create user balance if not exists
				await tx
					.insert(userBalances)
					.values({
						userId: session.user.id,
						creatorId: invite.creatorId,
						credits: 0,
					})
					.onConflictDoNothing();
			}
		});

		revalidatePath("/dashboard/subscriptions");
		revalidatePath("/dashboard");
		return { success: true };
	});
}
