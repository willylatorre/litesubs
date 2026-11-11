import { z } from "zod";
import { BILLING_INTERVALS, BILLING_MODES, CURRENCIES } from "@/lib/constants";

/**
 * Commercial terms for a plan. Price is entered in major units (10 means
 * $10.00) and stored in minor units; API responses always return minor units.
 *
 * The fields are defined without defaults on purpose: `default()` survives
 * `.partial()` in Zod 4, which would silently inject `billingMode: "one_time"`
 * into a patch and turn a monthly draft into a one-time offer. Defaults are
 * applied only when creating a plan.
 */
const planTermsFields = z.object({
	billingMode: z.enum(BILLING_MODES).default("one_time"),
	currency: z.enum(CURRENCIES).default("usd"),
	price: z.coerce
		.number()
		.finite()
		.min(0, "Price must be positive")
		.max(1_000_000, "Price is too high"),
	credits: z.coerce
		.number()
		.int()
		.min(1, "Credits must be at least 1")
		.max(1_000_000),
	interval: z.enum(BILLING_INTERVALS).nullable().optional(),
});

/** Patch fields, deliberately without the create-time defaults (see above). */
const planTermsPatchFields = z.object({
	billingMode: z.enum(BILLING_MODES),
	currency: z.enum(CURRENCIES),
	price: z.coerce
		.number()
		.finite()
		.min(0, "Price must be positive")
		.max(1_000_000, "Price is too high"),
	credits: z.coerce
		.number()
		.int()
		.min(1, "Credits must be at least 1")
		.max(1_000_000),
	interval: z.enum(BILLING_INTERVALS).nullable().optional(),
});

function checkTerms(
	terms: Partial<z.infer<typeof planTermsFields>>,
	ctx: z.RefinementCtx,
) {
	// Monthly is the only recurring interval in v1. Reject rather than silently
	// coercing, so an API caller never buys different terms than it sent.
	if (terms.billingMode === "recurring" && terms.interval !== "month")
		ctx.addIssue({
			code: "custom",
			path: ["interval"],
			message: "Recurring plans must use the monthly interval",
		});
	if (terms.billingMode === "one_time" && terms.interval)
		ctx.addIssue({
			code: "custom",
			path: ["interval"],
			message: "One-time plans cannot have a billing interval",
		});
	if (
		terms.billingMode === "one_time" &&
		terms.price !== undefined &&
		terms.price <= 0
	)
		ctx.addIssue({
			code: "custom",
			path: ["price"],
			message: "A one-time plan must cost more than zero",
		});
}

export const planTermsSchema = planTermsFields.superRefine(checkTerms);

/** Partial terms validated as a set once merged with the existing draft. */
export const planTermsPatchSchema = planTermsPatchFields
	.partial()
	.superRefine((terms, ctx) => {
		if (!terms.billingMode && !terms.interval) return;
		checkTerms(terms, ctx);
	});

export const createPlanSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(200),
	description: z.string().trim().max(5000).optional(),
	terms: planTermsSchema,
});

export const updatePlanSchema = z
	.object({
		name: z.string().trim().min(1).max(200).optional(),
		description: z.string().trim().max(5000).nullable().optional(),
		terms: planTermsPatchSchema.optional(),
	})
	.refine(
		(data) =>
			data.name !== undefined ||
			data.description !== undefined ||
			(data.terms && Object.keys(data.terms).length > 0),
		"Provide at least one field to update",
	);

export const createInviteSchema = z.object({
	email: z.string().email().optional().or(z.literal("")),
	planId: z.string().optional(),
});

export type PlanTermsInput = z.input<typeof planTermsSchema>;
