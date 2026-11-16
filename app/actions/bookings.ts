"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authenticatedAction } from "@/lib/safe-action";
import { cancelBooking, createBooking } from "@/lib/services/bookings";
import { ServiceError } from "@/lib/services/principal";

/**
 * Server actions for native bookings.
 *
 * The customer is taken from the session, never from the request body: a booking
 * spends that user's credits, so the caller must not be able to name someone
 * else. `creatorId` on the principal is the acting user for a customer session;
 * the booking service resolves the real creator from the schedule.
 */

async function customerPrincipal() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return null;
	// A customer acts for themselves. The booking service reads the schedule to
	// find the creator and scopes the debit to that creator's plan.
	return {
		kind: "session" as const,
		creatorId: session.user.id,
		userId: session.user.id,
		scopes: [
			"plans:read",
			"customers:read",
			"customers:write",
			"billing:read",
		] as const,
	};
}

const bookingInput = z.object({
	scheduleId: z.string().trim().min(1).max(200),
	startsAt: z.string().trim().min(1),
});

export async function bookSlot(input: {
	scheduleId: string;
	startsAt: string;
}) {
	const principal = await customerPrincipal();
	if (!principal) {
		return {
			success: false,
			error: "Sign in to book. Your credits live on your account.",
			code: "SIGN_IN_REQUIRED",
		};
	}
	try {
		const data = bookingInput.parse(input);
		const result = await createBooking(principal, data);
		revalidatePath("/dashboard");
		return { success: true, data: result };
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof ServiceError
					? error.message
					: "Could not book that slot",
			code: error instanceof ServiceError ? error.code : undefined,
		};
	}
}

export async function cancelCustomerBooking(bookingId: string) {
	const principal = await customerPrincipal();
	if (!principal) return { success: false, error: "Unauthorized" };
	try {
		const result = await cancelBooking(principal, { bookingId });
		revalidatePath("/dashboard");
		return { success: true, data: result };
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof ServiceError
					? error.message
					: "Could not cancel that booking",
			code: error instanceof ServiceError ? error.code : undefined,
		};
	}
}

/** Used by the booking page to send an anonymous visitor through sign-in. */
export async function requireSignIn(nextPath: string) {
	redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(nextPath)}`);
}

/** Creator-side cancel, scoped by the booking service to the schedule owner. */
export async function cancelCreatorBooking(bookingId: string) {
	return authenticatedAction(async (session) => {
		try {
			const result = await cancelBooking(
				{
					kind: "session",
					creatorId: session.user.id,
					userId: session.user.id,
					scopes: [
						"plans:read",
						"customers:read",
						"customers:write",
						"billing:read",
					],
				},
				{ bookingId },
			);
			revalidatePath("/dashboard/bookings");
			return { success: true, data: result };
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof ServiceError
						? error.message
						: "Could not cancel that booking",
				code: error instanceof ServiceError ? error.code : undefined,
			};
		}
	});
}
