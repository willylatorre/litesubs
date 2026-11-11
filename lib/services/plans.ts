import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { enrollments, plans, planVersions } from "@/app/db/schema";
import { createPlanSchema, updatePlanSchema } from "@/lib/schemas";
import { type Principal, requireScope, ServiceError } from "./principal";

export const pageInput = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
});

type PlanRow = typeof plans.$inferSelect;
type PlanVersionRow = typeof planVersions.$inferSelect;

/** Published terms are frozen; the creator edits a separate draft working copy. */
export type PlanTerms = Pick<
	PlanVersionRow,
	| "id"
	| "billingMode"
	| "interval"
	| "currency"
	| "price"
	| "credits"
	| "status"
	| "version"
	| "publishedAt"
>;

export type PlanDetail = PlanRow & {
	terms: PlanTerms | null;
	/** True while no published terms exist, so the plan cannot be sold. */
	isDraft: boolean;
};

function toTerms(version: PlanVersionRow | undefined): PlanTerms | null {
	if (!version) return null;
	return {
		id: version.id,
		billingMode: version.billingMode,
		interval: version.interval,
		currency: version.currency,
		price: version.price,
		credits: version.credits,
		status: version.status,
		version: version.version,
		publishedAt: version.publishedAt,
	};
}

/**
 * Describe a plan with the terms a creator is currently preparing and whether
 * anything is sellable. Draft terms take precedence for editing; otherwise the
 * newest published version is the offer.
 *
 * Reads through the caller's connection so a value written inside a transaction
 * is visible in the same transaction.
 */
async function withTerms(
	plan: PlanRow,
	client: Pick<typeof db, "query"> = db,
): Promise<PlanDetail> {
	const versions = await client.query.planVersions.findMany({
		where: eq(planVersions.planId, plan.id),
		orderBy: [desc(planVersions.version)],
	});
	const draft = versions.find((version) => version.status === "draft");
	const published = versions.find((version) => version.status === "published");
	return {
		...plan,
		terms: toTerms(draft ?? published),
		isDraft: !published,
	};
}

// Resolve exact IDs/names only within this creator. Never guess a fuzzy match.
export async function resolvePlan(principal: Principal, identifier: string) {
	const matches = await db.query.plans.findMany({
		where: and(
			eq(plans.creatorId, principal.creatorId),
			or(
				eq(plans.id, identifier),
				sql`lower(${plans.name}) = ${identifier.trim().toLowerCase()}`,
			),
		),
	});
	if (!matches.length)
		throw new ServiceError("NOT_FOUND", "Plan not found", 404);
	if (matches.length > 1)
		throw new ServiceError(
			"AMBIGUOUS",
			"More than one plan matches; use its ID",
			409,
			matches.map(({ id, name }) => ({ id, name })),
		);
	return matches[0];
}

/**
 * Resolve a plan for a purchase. Drafts and plans without published terms are
 * never purchasable, whatever transport asked for them.
 */
export async function resolvePublishedPlan(
	creatorId: string,
	identifier: string,
	client: Pick<typeof db, "query"> = db,
) {
	const matches = await client.query.plans.findMany({
		where: and(
			eq(plans.creatorId, creatorId),
			or(
				eq(plans.id, identifier),
				sql`lower(${plans.name}) = ${identifier.trim().toLowerCase()}`,
			),
		),
		with: { versions: { orderBy: [desc(planVersions.version)] } },
	});
	if (!matches.length)
		throw new ServiceError("NOT_FOUND", "Plan not found", 404);
	if (matches.length > 1)
		throw new ServiceError("AMBIGUOUS", "Use the plan's exact ID", 409);
	const plan = matches[0];
	const published = plan.versions.find(
		(version) => version.status === "published",
	);
	if (!published)
		throw new ServiceError(
			"PLAN_NOT_PUBLISHED",
			"This plan is a draft and cannot be purchased yet",
			409,
		);
	return { plan, terms: published };
}

export async function listPlans(principal: Principal, input: unknown = {}) {
	requireScope(principal, "plans:read");
	const page = pageInput.parse(input);
	const rows = await db.query.plans.findMany({
		where: eq(plans.creatorId, principal.creatorId),
		orderBy: [desc(plans.createdAt), desc(plans.id)],
		...page,
		with: { integration: { with: { calcomIntegration: true } } },
	});
	return Promise.all(rows.map((plan) => withTerms(plan)));
}

export async function getPlan(principal: Principal, identifier: string) {
	requireScope(principal, "plans:read");
	const plan = await resolvePlan(principal, identifier);
	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(enrollments)
		.where(
			and(
				eq(enrollments.planId, plan.id),
				eq(enrollments.creatorId, principal.creatorId),
			),
		);
	return { ...(await withTerms(plan)), enrollmentCount: count };
}

export async function createPlan(principal: Principal, input: unknown) {
	requireScope(principal, "plans:write");
	const data = createPlanSchema.parse(input);
	// Draft creation is local-only: no Stripe call and no platform Customer.
	return db.transaction(async (tx) => {
		const [plan] = await tx
			.insert(plans)
			.values({
				creatorId: principal.creatorId,
				name: data.name,
				description: data.description,
			})
			.returning();
		const [terms] = await tx
			.insert(planVersions)
			.values({
				planId: plan.id,
				creatorId: principal.creatorId,
				status: "draft",
				billingMode: data.terms.billingMode,
				interval:
					data.terms.billingMode === "recurring"
						? (data.terms.interval ?? "month")
						: null,
				currency: data.terms.currency,
				price: Math.round(data.terms.price * 100),
				credits: data.terms.credits,
			})
			.returning();
		return { ...plan, terms: toTerms(terms), isDraft: true };
	});
}

export async function updatePlan(
	principal: Principal,
	identifier: string,
	input: unknown,
) {
	requireScope(principal, "plans:write");
	const data = updatePlanSchema.parse(input);
	const plan = await resolvePlan(principal, identifier);
	return db.transaction(async (tx) => {
		if (data.name !== undefined || data.description !== undefined) {
			await tx
				.update(plans)
				.set({
					...(data.name === undefined ? {} : { name: data.name }),
					...(data.description === undefined
						? {}
						: { description: data.description }),
				})
				.where(
					and(eq(plans.id, plan.id), eq(plans.creatorId, principal.creatorId)),
				);
		}
		if (data.terms && Object.keys(data.terms).length > 0) {
			// Commercial terms are replaced as a set so a draft can never hold a
			// price from one currency/mode and credits from another.
			if (!hasCompleteTerms(data.terms))
				throw new ServiceError(
					"INVALID_TERMS",
					"Provide billing mode, currency, price, and credits together",
				);
			await upsertDraftTerms(tx, principal, plan.id, data.terms);
		}
		const [updated] = await tx
			.select()
			.from(plans)
			.where(
				and(eq(plans.id, plan.id), eq(plans.creatorId, principal.creatorId)),
			);
		return withTerms(updated, tx);
	});
}

function hasCompleteTerms(terms: Record<string, unknown>) {
	return (
		terms.billingMode !== undefined &&
		terms.currency !== undefined &&
		terms.price !== undefined &&
		terms.credits !== undefined
	);
}

/**
 * Write commercial terms to the draft working copy only. A published version is
 * immutable; replacing its terms is a later publication slice's job.
 */
async function upsertDraftTerms(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	principal: Principal,
	planId: string,
	terms: Partial<PlanTerms>,
) {
	const existing = await tx.query.planVersions.findFirst({
		where: and(
			eq(planVersions.planId, planId),
			eq(planVersions.status, "draft"),
		),
		orderBy: [desc(planVersions.version)],
	});
	const billingMode = terms.billingMode ?? existing?.billingMode ?? "one_time";
	const price =
		terms.price !== undefined ? Math.round(terms.price * 100) : undefined;
	const values = {
		...(billingMode === undefined ? {} : { billingMode }),
		...(terms.currency === undefined ? {} : { currency: terms.currency }),
		...(price === undefined ? {} : { price }),
		...(terms.credits === undefined ? {} : { credits: terms.credits }),
		// Interval follows billing mode; callers cannot leave monthly/one-time mixed.
		interval: (billingMode === "recurring" ? "month" : null) as "month" | null,
	};
	if (existing) {
		await tx
			.update(planVersions)
			.set(values)
			.where(eq(planVersions.id, existing.id));
		return;
	}
	const [{ maxVersion }] = await tx
		.select({
			maxVersion: sql<number>`coalesce(max(${planVersions.version}), 0)::int`,
		})
		.from(planVersions)
		.where(eq(planVersions.planId, planId));
	await tx.insert(planVersions).values({
		planId,
		creatorId: principal.creatorId,
		status: "draft",
		billingMode,
		interval: billingMode === "recurring" ? "month" : null,
		currency: terms.currency ?? "usd",
		price: price ?? 0,
		credits: terms.credits ?? 1,
		version: maxVersion + 1,
	});
}
