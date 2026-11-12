"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authenticatedAction } from "@/lib/safe-action";
import { createCustomerBillingPortalSession } from "@/lib/services/billing-portal";
import { ServiceError } from "@/lib/services/principal";
import { updateCustomerSubscriptionCancellation } from "@/lib/services/subscriptions";

const cancellationInput = z.object({
	subscriptionId: z.string().trim().min(1).max(200),
	cancelAtPeriodEnd: z.boolean(),
});

/** Customer-only cancel/resume actions; the service scopes by the session user. */
export async function setSubscriptionCancellation(
	subscriptionId: string,
	cancelAtPeriodEnd: boolean,
) {
	return authenticatedAction(async (session) => {
		try {
			const input = cancellationInput.parse({
				subscriptionId,
				cancelAtPeriodEnd,
			});
			const result = await updateCustomerSubscriptionCancellation({
				userId: session.user.id,
				...input,
			});
			if (result.changed) {
				revalidatePath("/dashboard");
				revalidatePath(`/dashboard/enrollments/${result.enrollmentId}`);
			}
			return { success: true, data: result };
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof ServiceError
						? error.message
						: error instanceof z.ZodError
							? "Invalid subscription request"
							: "Could not update the subscription",
			};
		}
	});
}

/** Create a short-lived, account-scoped Customer Portal session on demand. */
export async function openCustomerBillingPortal(subscriptionId: string) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) return { error: "Unauthorized" };

	let portalUrl: string;
	try {
		const input = z.string().trim().min(1).max(200).parse(subscriptionId);
		({ url: portalUrl } = await createCustomerBillingPortalSession(
			session.user.id,
			input,
		));
	} catch (error) {
		return {
			error:
				error instanceof ServiceError
					? error.message
					: error instanceof z.ZodError
						? "Invalid subscription"
						: "Could not open billing management",
		};
	}
	// Redirect is outside the try block because Next.js implements it as a
	// framework control-flow exception.
	redirect(portalUrl);
}
