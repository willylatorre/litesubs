/**
 * Sample workspace data shown to first-time creators.
 *
 * Every row uses a deterministic ID derived from the creator ID so the data can
 * be found and removed exactly, without a schema flag and without ever touching
 * rows the user created themselves.
 */
export const SAMPLE_PLAN = {
	name: "Algebra Tutoring",
	description:
		"10 tutoring credits, used one session at a time. Sample plan — edit it or remove it whenever you like.",
	price: 10_000, // cents
	credits: 10,
	currency: "usd",
} as const;

export const SAMPLE_CUSTOMER_NAME = "Ana Rivera";

/** Auth IDs are opaque; keep the sample email address syntactically valid. */
function emailSafe(id: string) {
	return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function sampleIds(creatorId: string) {
	const slug = emailSafe(creatorId);
	return {
		plan: `sample-plan-${creatorId}`,
		planVersion: `sample-plan-version-${creatorId}`,
		customer: `sample-customer-${creatorId}`,
		customerEmail: `ana.rivera+${slug}@example.com`,
		enrollment: `sample-enrollment-${creatorId}`,
		invite: `sample-invite-${creatorId}`,
		inviteEmail: `leo.martin+${slug}@example.com`,
		purchaseTransaction: `sample-tx-purchase-${creatorId}`,
		payment: `sample-payment-${creatorId}`,
		usageTransaction: `sample-tx-usage-${creatorId}`,
		grant: `sample-grant-${creatorId}`,
		usageAllocation: `sample-allocation-${creatorId}`,
	};
}

/**
 * Sample rows are identified by their ID prefix, so any screen can label them
 * without a second query per row.
 */
export function isSamplePlanId(id: string | null | undefined) {
	return Boolean(id?.startsWith("sample-plan-"));
}

export function isSampleCustomerId(id: string | null | undefined) {
	return Boolean(id?.startsWith("sample-customer-"));
}

export function isSampleInviteId(id: string | null | undefined) {
	return Boolean(id?.startsWith("sample-invite-"));
}
