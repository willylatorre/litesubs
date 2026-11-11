"use server";

import { and, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/app/db";
import { invites } from "@/app/db/schema";
import { authenticatedAction } from "@/lib/safe-action";
import {
	claimEnrollmentInvite,
	createInvite as createInviteService,
	listInvites,
} from "@/lib/services/enroll";
import { sessionPrincipal } from "@/lib/services/principal";

export async function createInvite(_prevState: unknown, formData: FormData) {
	return authenticatedAction(async (session) => {
		const invite = await createInviteService(
			sessionPrincipal(session.user.id),
			{
				email: formData.get("email") || undefined,
				planId:
					formData.get("planId") === "undefined"
						? undefined
						: formData.get("planId") || undefined,
			},
		);
		revalidatePath("/dashboard/creator");
		return { success: true, token: invite.token };
	});
}

export async function getCreatorInvites() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await listInvites(sessionPrincipal(session.user.id), { limit: 100 }),
	})).then((res) => res.data ?? []);
}

export async function getUserPendingInvites() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await db.query.invites.findMany({
			where: and(
				eq(invites.email, session.user.email),
				eq(invites.status, "pending"),
				gt(invites.expiresAt, new Date()),
			),
			with: { creator: true, plan: true },
		}),
	})).then((res) => res.data ?? []);
}

export async function claimInvite(token: string) {
	return authenticatedAction(async (session) => {
		await claimEnrollmentInvite(session.user.id, session.user.email, token);
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
				gt(invites.expiresAt, new Date()),
			),
		});
		if (!invite) return { error: "Invite unavailable or expired" };
		if (accept)
			await claimEnrollmentInvite(
				session.user.id,
				session.user.email,
				invite.token,
			);
		else
			await db
				.update(invites)
				.set({ status: "rejected" })
				.where(and(eq(invites.id, invite.id), eq(invites.status, "pending")));
		revalidatePath("/dashboard");
		return { success: true };
	});
}
