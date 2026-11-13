"use server";

import { revalidatePath } from "next/cache";
import { authenticatedAction } from "@/lib/safe-action";
import {
	disconnectAccount,
	getPaymentReadiness,
	startNewAccountOnboarding,
	syncConnectedAccount,
} from "@/lib/services/connect";
import { ServiceError } from "@/lib/services/principal";

/**
 * Thin creator-facing wrappers over the connected-account service. The
 * service owns readiness rules; these only bind the session and revalidate.
 */

export async function getPaymentsStatus() {
	return authenticatedAction(async (session) => ({
		success: true,
		data: await getPaymentReadiness(session.user.id),
	}));
}

/** Start or resume new-account onboarding and return the Stripe-hosted URL. */
export async function startStripeOnboarding() {
	return authenticatedAction<{ url: string }>(async (session) => {
		try {
			const result = await startNewAccountOnboarding({
				creatorId: session.user.id,
				email: session.user.email,
			});
			revalidatePath("/dashboard/payments");
			return { success: true, data: { url: result.url } };
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof ServiceError
						? error.message
						: "Could not start Stripe onboarding",
			};
		}
	});
}

/** Re-read Stripe after onboarding returns or a requirement changes. */
export async function refreshPaymentsStatus() {
	return authenticatedAction(async (session) => {
		try {
			const readiness = await syncConnectedAccount(session.user.id);
			revalidatePath("/dashboard/payments");
			return { success: true, data: readiness };
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof ServiceError
						? error.message
						: "Could not refresh Stripe status",
			};
		}
	});
}

export async function disconnectStripeAccount(cancelLiveSubscriptions = false) {
	return authenticatedAction(async (session) => {
		try {
			const result = await disconnectAccount(session.user.id, {
				cancelLiveSubscriptions,
			});
			revalidatePath("/dashboard/payments");
			revalidatePath("/dashboard/plans");
			revalidatePath("/dashboard");
			return { success: true, data: result };
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof ServiceError
						? error.message
						: "Could not disconnect the Stripe account",
				code: error instanceof ServiceError ? error.code : undefined,
				liveSubscriptions:
					error instanceof ServiceError &&
					typeof error.details === "object" &&
					error.details !== null &&
					"liveSubscriptions" in error.details
						? Number(
								(error.details as { liveSubscriptions: unknown })
									.liveSubscriptions,
							)
						: undefined,
			};
		}
	});
}
