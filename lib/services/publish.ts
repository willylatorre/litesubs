import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/app/db";
import { plans, planVersions } from "@/app/db/schema";
import {
	minimumChargeFor,
	type PlanOfferAdapter,
	planOfferAdapter,
	StripeOfferError,
} from "@/lib/stripe-offers";
import { getPaymentReadiness } from "./connect";
import { resolvePlan, sameOffer } from "./plans";
import { type Principal, requireScope, ServiceError } from "./principal";

/**
 * Publication: the only path that turns draft terms into an offer a customer
 * can buy.
 *
 * Two invariants drive the implementation:
 *
 * 1. A `published` row never exists without the Stripe objects it sells. The
 *    Product/Price are provisioned first, on the creator's account, and only
 *    then is the draft flipped in a single transaction. A failed provisioning
 *    therefore leaves an untouched, retryable draft rather than a half-sellable
 *    version.
 * 2. Retries and concurrent attempts converge on one offer. Stripe calls use
 *    keys derived from the plan-version row and the terms, and the local
 *    transition runs under a per-plan advisory lock so a losing attempt
 *    observes the committed result instead of superseding it.
 *
 * `draft` stays the creator's working copy: publishing freezes that row and the
 * next terms edit allocates a new draft, so already-sold terms cannot be
 * mutated underneath an existing customer.
 */

type PlanVersionRow = typeof planVersions.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const publishInput = z.object({
	plan: z.string().trim().min(1),
});

/**
 * Unpublishing stops new sales, so it demands an explicit confirmation from
 * every transport — including MCP, where a model could otherwise stop a
 * creator's sales by accident.
 */
export const unpublishInput = z.object({
	plan: z.string().trim().min(1),
	confirm: z.literal(true, {
		error: "Unpublishing requires confirm: true",
	}),
});

export type PublicationTerms = {
	billingMode: "one_time" | "recurring";
	interval: "month" | null;
	currency: string;
	price: number;
	credits: number;
};

export type PublicationResult = {
	status:
		| "published"
		| "already_published"
		| "unchanged"
		| "unpublished"
		| "already_unpublished";
	planId: string;
	version: number;
	terms: PublicationTerms;
	stripeAccountId?: string | null;
	stripeProductId?: string | null;
	stripePriceId?: string | null;
	message?: string;
};

function termsOf(version: PlanVersionRow): PublicationTerms {
	return {
		billingMode: version.billingMode,
		interval: version.interval,
		currency: version.currency,
		price: version.price,
		credits: version.credits,
	};
}

function describe(version: PlanVersionRow) {
	return {
		planId: version.planId,
		version: version.version,
		terms: termsOf(version),
		stripeAccountId: version.stripeAccountId,
		stripeProductId: version.stripeProductId,
		stripePriceId: version.stripePriceId,
	};
}

/**
 * Terms Stripe can actually charge. A zero-price offer is a complimentary
 * enrollment, not a paid plan, so it is refused here rather than failing at the
 * creator's first checkout.
 */
function assertPurchasable(version: PlanVersionRow) {
	if (version.credits <= 0)
		throw new ServiceError(
			"INVALID_TERMS",
			"A plan must grant at least one credit",
			409,
		);
	const minimum = minimumChargeFor(version.currency);
	if (minimum === null)
		throw new ServiceError(
			"INVALID_TERMS",
			`Stripe does not support pricing plans in ${version.currency.toUpperCase()}`,
			409,
		);
	if (version.price < minimum)
		throw new ServiceError(
			"PRICE_BELOW_MINIMUM",
			`Stripe's minimum charge in ${version.currency.toUpperCase()} is ${(minimum / 100).toFixed(2)}. Raise the price before publishing.`,
			409,
			{ minimum, currency: version.currency },
		);
}

function lockPlan(tx: Tx, planId: string) {
	return tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`plan-publish:${planId}`}, 0))`,
	);
}

async function versionsOf(client: Pick<typeof db, "query">, planId: string) {
	return client.query.planVersions.findMany({
		where: eq(planVersions.planId, planId),
		orderBy: [desc(planVersions.version)],
	});
}

/** Provision the offer on the creator's own account, or replay a retried call. */
async function provisionOffer(input: {
	creatorId: string;
	plan: { name: string; description: string | null };
	version: PlanVersionRow;
	adapter: PlanOfferAdapter;
}) {
	const { plan, version, adapter } = input;
	// Published terms belong to the account that will charge for them.
	const readiness = await getPaymentReadiness(input.creatorId);
	if (!readiness.canSell || !readiness.stripeAccountId)
		throw new ServiceError(
			"PAYMENTS_NOT_READY",
			"Connect a payment-ready Stripe account before publishing",
			409,
			{ status: readiness.status, requirementsDue: readiness.requirementsDue },
		);
	const offerInput = {
		stripeAccountId: readiness.stripeAccountId,
		versionId: version.id,
		name: plan.name,
		description: plan.description,
		currency: version.currency,
		unitAmount: version.price,
		interval: version.interval,
	};
	try {
		const product = await adapter.createProduct(offerInput);
		const price = await adapter.createPrice({
			...offerInput,
			productId: product.id,
		});
		return {
			stripeAccountId: readiness.stripeAccountId,
			stripeProductId: product.id,
			stripePriceId: price.id,
		};
	} catch (error) {
		if (error instanceof StripeOfferError)
			throw new ServiceError(error.code, error.message, 502);
		throw error;
	}
}

export async function publishPlan(
	principal: Principal,
	input: unknown,
	adapter: PlanOfferAdapter = planOfferAdapter,
): Promise<PublicationResult> {
	requireScope(principal, "plans:write");
	const data = publishInput.parse(input);
	const plan = await resolvePlan(principal, data.plan);

	const versions = await versionsOf(db, plan.id);
	const draft = versions.find((version) => version.status === "draft");
	const published = versions.find((version) => version.status === "published");

	if (!draft) {
		// A retry after a commit that succeeded but whose response was lost, or a
		// second concurrent attempt: report the offer that is live.
		if (published)
			return { status: "already_published", ...describe(published) };
		throw new ServiceError(
			"NO_TERMS",
			"Add commercial terms before publishing",
			409,
		);
	}
	if (published && sameOffer(draft, published))
		return {
			status: "unchanged",
			...describe(published),
			message:
				"This plan is already published with these terms. Edit the terms to publish a change.",
		};

	assertPurchasable(draft);
	const provisioned = await provisionOffer({
		creatorId: principal.creatorId,
		plan,
		version: draft,
		adapter,
	});

	return db.transaction(async (tx) => {
		// One publisher per plan at a time. The Stripe calls above are idempotent,
		// so a losing attempt costs nothing but still cannot race the transition.
		await lockPlan(tx, plan.id);
		const [current] = await tx
			.select({ id: plans.id })
			.from(plans)
			.where(
				and(eq(plans.id, plan.id), eq(plans.creatorId, principal.creatorId)),
			)
			.for("update");
		if (!current) throw new ServiceError("NOT_FOUND", "Plan not found", 404);

		const locked = await versionsOf(tx, plan.id);
		const lockedDraft = locked.find((version) => version.status === "draft");
		const lockedPublished = locked.find(
			(version) => version.status === "published",
		);
		if (!lockedDraft) {
			if (lockedPublished)
				return {
					status: "already_published" as const,
					...describe(lockedPublished),
				};
			throw new ServiceError(
				"NO_TERMS",
				"Add commercial terms before publishing",
				409,
			);
		}
		// The terms we provisioned must still be the terms we freeze. Editing the
		// draft mid-flight is a retryable conflict, not a silent mismatch between
		// the Stripe Price and the published row.
		if (lockedDraft.id !== draft.id || !sameOffer(lockedDraft, draft))
			throw new ServiceError(
				"PUBLISH_CONFLICT",
				"This plan changed while publishing. Try again.",
				409,
			);

		const now = new Date();
		if (lockedPublished)
			await tx
				.update(planVersions)
				.set({ status: "superseded", unpublishedAt: now })
				.where(eq(planVersions.id, lockedPublished.id));
		const [committed] = await tx
			.update(planVersions)
			.set({
				status: "published",
				publishedAt: now,
				unpublishedAt: null,
				stripeAccountId: provisioned.stripeAccountId,
				stripeProductId: provisioned.stripeProductId,
				stripePriceId: provisioned.stripePriceId,
			})
			.where(
				and(
					eq(planVersions.id, lockedDraft.id),
					eq(planVersions.status, "draft"),
				),
			)
			.returning();
		if (!committed)
			throw new ServiceError(
				"PUBLISH_CONFLICT",
				"This plan changed while publishing. Try again.",
				409,
			);
		return { status: "published" as const, ...describe(committed) };
	});
}

/**
 * Stop new sales. Purchased versions, credit grants, and existing Stripe
 * subscriptions are untouched: only the offer stops being current.
 *
 * A fresh draft copies the stopped terms so "publish" can bring the same offer
 * back with one action — but as a new version with its own Stripe Price. An
 * existing draft (terms the creator was already preparing) is kept as-is.
 */
export async function unpublishPlan(
	principal: Principal,
	input: unknown,
	adapter: PlanOfferAdapter = planOfferAdapter,
): Promise<PublicationResult> {
	requireScope(principal, "plans:write");
	const data = unpublishInput.parse(input);
	const plan = await resolvePlan(principal, data.plan);

	const stopped = await db.transaction(async (tx) => {
		await lockPlan(tx, plan.id);
		const versions = await versionsOf(tx, plan.id);
		const published = versions.find(
			(version) => version.status === "published",
		);
		if (!published) {
			const latest = versions.find(
				(version) => version.status === "superseded",
			);
			if (!latest)
				throw new ServiceError(
					"NOT_PUBLISHED",
					"This plan is not published",
					409,
				);
			return { changed: false as const, version: latest };
		}
		const [updated] = await tx
			.update(planVersions)
			.set({ status: "superseded", unpublishedAt: new Date() })
			.where(
				and(
					eq(planVersions.id, published.id),
					eq(planVersions.status, "published"),
				),
			)
			.returning();
		if (!updated)
			throw new ServiceError(
				"PUBLISH_CONFLICT",
				"This plan changed while unpublishing. Try again.",
				409,
			);
		const hasDraft = versions.some((version) => version.status === "draft");
		if (!hasDraft) {
			const nextVersion =
				Math.max(...versions.map((version) => version.version)) + 1;
			await tx.insert(planVersions).values({
				planId: plan.id,
				creatorId: principal.creatorId,
				status: "draft",
				billingMode: updated.billingMode,
				interval: updated.interval,
				currency: updated.currency,
				price: updated.price,
				credits: updated.credits,
				version: nextVersion,
			});
		}
		return { changed: true as const, version: updated };
	});

	if (!stopped.changed)
		return {
			status: "already_unpublished",
			...describe(stopped.version),
			message: "This plan is not published.",
		};

	// Defense in depth: an archived Price cannot start a new charge even if a
	// checkout link to it leaks. Existing subscriptions keep renewing, and a
	// failure here must not undo the local transition.
	const notes: string[] = [];
	const { stripeAccountId, stripePriceId, stripeProductId } = stopped.version;
	if (stripeAccountId && stripePriceId) {
		try {
			await adapter.deactivatePrice({
				stripeAccountId,
				priceId: stripePriceId,
			});
		} catch {
			notes.push("Could not deactivate the Stripe price");
		}
	}
	if (stripeAccountId && stripeProductId) {
		try {
			await adapter.deactivateProduct({
				stripeAccountId,
				productId: stripeProductId,
			});
		} catch {
			notes.push("Could not deactivate the Stripe product");
		}
	}

	return {
		status: "unpublished",
		...describe(stopped.version),
		...(notes.length ? { message: notes.join(". ") } : {}),
	};
}
