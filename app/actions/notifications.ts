"use server";

import { revalidatePath } from "next/cache";
import { authenticatedAction } from "@/lib/safe-action";
import {
	listNotifications,
	markAllRead,
	markRead,
	notificationsStartingSoon,
	unreadCount,
} from "@/lib/services/notifications";

/**
 * Notification reads and mark-read writes for the bell.
 *
 * Every call passes `session.user.id` as the owner, so the client cannot name a
 * different user. Ids sent from the browser are scoped by the same predicate in
 * the service, which means a forged id affects zero rows rather than someone
 * else's notification.
 */

const BELL_LIMIT = 15;

/** The bell's payload: derived "starting soon" plus the persisted feed. */
export async function getNotificationFeed() {
	return authenticatedAction(async (session) => {
		const now = new Date();
		const [items, startingSoon, unread] = await Promise.all([
			listNotifications(session.user.id, { limit: BELL_LIMIT }),
			notificationsStartingSoon(session.user.id, now),
			unreadCount(session.user.id),
		]);
		return {
			success: true,
			data: { items, startingSoon, unreadCount: unread },
		};
	});
}

/** Own notifications only; a page of the feed behind the bell. */
export async function getNotifications(input?: {
	limit?: number;
	offset?: number;
	before?: string;
}) {
	return authenticatedAction(async (session) => {
		const items = await listNotifications(session.user.id, {
			limit: input?.limit,
			offset: input?.offset,
			before: input?.before,
		});
		return { success: true, data: items };
	});
}

export async function getUnreadNotificationCount() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await unreadCount(session.user.id),
	}));
}

/**
 * Mark the given ids read. Derived "starting soon" ids are ignored by the
 * service (they are not rows), so the client can pass whatever it renders.
 */
export async function markNotificationsRead(ids: string[]) {
	return authenticatedAction(async (session) => {
		if (!Array.isArray(ids)) return { error: "Invalid notification ids" };
		const updated = await markRead(session.user.id, ids);
		revalidatePath("/dashboard");
		return { success: true, data: { updated } };
	});
}

export async function markAllNotificationsRead() {
	return authenticatedAction(async (session) => {
		const updated = await markAllRead(session.user.id);
		revalidatePath("/dashboard");
		return { success: true, data: { updated } };
	});
}
