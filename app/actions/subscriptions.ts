"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authenticatedAction } from "@/lib/safe-action";
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
