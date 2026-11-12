/**
 * Publication is the boundary between "a draft the creator is preparing" and
 * "an offer a customer can be charged for". These tests run against the real
 * service and database; only the Stripe adapter is stubbed, because the
 * assertions are about lifecycle, idempotency, and written rows — not Stripe's
 * HTTP behaviour.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/app/db";
import { enrollments, plans, planVersions, user } from "@/app/db/schema";
import { connectedAccounts } from "@/app/db/stripe-connect-schema";
import {
	createPlan,
	resolvePublishedPlan,
	updatePlan,
} from "@/lib/services/plans";
import { sessionPrincipal } from "@/lib/services/principal";
import { publishPlan, unpublishPlan } from "@/lib/services/publish";
import type { PlanOfferAdapter } from "@/lib/stripe-offers";
import { StripeOfferError } from "@/lib/stripe-offers";

/** Records what publishing would have created, without calling Stripe. */
function stubAdapter(options?: { failOn?: "product" | "price" }) {
	const calls: { product: string[]; price: string[] } = {
		product: [],
		price: [],
	};
	const deactivated: string[] = [];
	let sequence = 0;
	const adapter: PlanOfferAdapter = {
		async createProduct(input) {
			if (options?.failOn === "product")
				throw new StripeOfferError("STRIPE_UNAVAILABLE", "simulated timeout");
			calls.product.push(input.versionId);
			sequence += 1;
			return { id: `prod_${sequence}` };
		},
		async createPrice(input) {
			if (options?.failOn === "price")
				throw new StripeOfferError("STRIPE_UNAVAILABLE", "simulated timeout");
			calls.price.push(`${input.productId}:${input.unitAmount}`);
			return { id: `price_${input.productId}_${input.unitAmount}` };
		},
		async deactivateProduct({ productId }) {
			deactivated.push(`product:${productId}`);
		},
		async deactivatePrice({ priceId }) {
			deactivated.push(`price:${priceId}`);
		},
	};
	return { adapter, calls, deactivated };
}

test("publication provisions once, freezes terms, and stops sales safely", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async (t) => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherId = crypto.randomUUID();
	const studentId = crypto.randomUUID();
	const creator = sessionPrincipal(creatorId);
	const other = sessionPrincipal(otherId);

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{ id: otherId, name: "Other", email: `${otherId}@example.test` },
		{ id: studentId, name: "Student", email: `${studentId}@example.test` },
	]);
	// A payment-ready connected account is a precondition, not something
	// publishing may assume.
	await db.insert(connectedAccounts).values({
		userId: creatorId,
		stripeAccountId: "acct_publisher",
		onboardingMode: "connected",
		authorizedViaOauth: true,
		status: "active",
		controllerType: "account",
		dashboardType: "full",
		feesPayer: "account",
		lossesPayments: "stripe",
		chargesEnabled: true,
		payoutsEnabled: true,
		cardPaymentsStatus: "active",
		detailsSubmitted: true,
		requirementsCurrentlyDue: [],
	});

	const draftPlan = async (name: string) =>
		createPlan(creator, {
			name,
			terms: {
				billingMode: "one_time",
				currency: "usd",
				price: 10,
				credits: 10,
			},
		});
	const versionsOf = (planId: string) =>
		db.query.planVersions.findMany({
			where: eq(planVersions.planId, planId),
			orderBy: (table, { asc }) => [asc(table.version)],
		});

	await t.test("a draft is not purchasable until it is published", async () => {
		const plan = await draftPlan("Before publish");
		await assert.rejects(resolvePublishedPlan(creatorId, plan.id), {
			code: "PLAN_NOT_PUBLISHED",
		});
	});

	await t.test(
		"publishing creates the offer on the creator account and freezes terms",
		async () => {
			const plan = await draftPlan("Algebra");
			const { adapter, calls } = stubAdapter();
			const result = await publishPlan(creator, { plan: plan.id }, adapter);

			assert.equal(result.status, "published");
			assert.equal(result.version, 1);
			assert.equal(result.stripeAccountId, "acct_publisher");
			assert.equal(result.stripeProductId, "prod_1");
			assert.equal(calls.product.length, 1);
			assert.equal(calls.price.length, 1);

			const versions = await versionsOf(plan.id);
			assert.equal(versions.length, 1);
			const published = versions[0];
			assert.equal(published.status, "published");
			assert.ok(published.publishedAt);
			assert.equal(published.unpublishedAt, null);
			assert.equal(published.stripeAccountId, "acct_publisher");
			assert.equal(published.stripeProductId, "prod_1");
			assert.ok(published.stripePriceId);

			// The exact same row is now sellable.
			const resolved = await resolvePublishedPlan(creatorId, plan.id);
			assert.equal(resolved.terms.id, published.id);
		},
	);

	await t.test(
		"retrying a publish does not create a second offer",
		async () => {
			const plan = await draftPlan("Retry");
			const first = stubAdapter();
			await publishPlan(creator, { plan: plan.id }, first.adapter);
			const retry = stubAdapter();
			const again = await publishPlan(
				creator,
				{ plan: plan.id },
				retry.adapter,
			);
			// Publishing needs a draft to act on; once committed, the repeat call is
			// answered from the committed row without touching Stripe again.
			assert.equal(again.status, "already_published");
			assert.equal(retry.calls.product.length, 0);
			assert.equal(retry.calls.price.length, 0);
			assert.equal((await versionsOf(plan.id)).length, 1);
		},
	);

	await t.test(
		"failed provisioning leaves a retryable draft and no published row",
		async () => {
			const plan = await draftPlan("Flaky Stripe");
			const { adapter } = stubAdapter({ failOn: "price" });
			await assert.rejects(publishPlan(creator, { plan: plan.id }, adapter), {
				code: "STRIPE_UNAVAILABLE",
			});
			const versions = await versionsOf(plan.id);
			assert.equal(versions.length, 1);
			assert.equal(versions[0].status, "draft");
			assert.equal(versions[0].stripeProductId, null);
			assert.equal(versions[0].stripePriceId, null);

			// The same draft publishes on the next attempt.
			const good = stubAdapter();
			const result = await publishPlan(
				creator,
				{ plan: plan.id },
				good.adapter,
			);
			assert.equal(result.status, "published");
		},
	);

	await t.test(
		"new terms supersede the old version while customers keep theirs",
		async () => {
			const plan = await draftPlan("Grandfathered");
			const first = stubAdapter();
			await publishPlan(creator, { plan: plan.id }, first.adapter);

			// A purchase is a real enrollment row against the published version.
			await db.insert(enrollments).values({
				userId: studentId,
				planId: plan.id,
				creatorId,
				credits: 10,
			});

			// Editing terms replaces the draft working copy, not the published row.
			await updatePlan(creator, plan.id, {
				terms: {
					billingMode: "one_time",
					currency: "usd",
					price: 25,
					credits: 30,
				},
			});
			const beforePublish = await versionsOf(plan.id);
			assert.equal(beforePublish.length, 2);
			const oldPublished = beforePublish.find(
				(version) => version.status === "published",
			);
			assert.equal(oldPublished?.price, 1000);
			assert.equal(oldPublished?.credits, 10);

			const second = stubAdapter();
			const result = await publishPlan(
				creator,
				{ plan: plan.id },
				second.adapter,
			);
			assert.equal(result.status, "published");
			assert.equal(result.version, 2);

			const after = await versionsOf(plan.id);
			const superseded = after.find(
				(version) => version.id === oldPublished?.id,
			);
			assert.equal(superseded?.status, "superseded");
			// Terms are byte-identical to what the customer bought.
			assert.equal(superseded?.price, 1000);
			assert.equal(superseded?.credits, 10);
			assert.ok(superseded?.unpublishedAt);
			// History is preserved, including the Stripe objects it sold with.
			assert.ok(superseded?.stripePriceId);
			assert.deepEqual(
				{ price: result.terms.price, credits: result.terms.credits },
				{ price: 2500, credits: 30 },
			);

			const enrollment = await db.query.enrollments.findFirst({
				where: and(
					eq(enrollments.userId, studentId),
					eq(enrollments.planId, plan.id),
				),
			});
			assert.equal(enrollment?.credits, 10);
		},
	);

	await t.test("unpublishing stops sales but keeps history", async () => {
		const plan = await draftPlan("Stop selling");
		const { adapter, deactivated } = stubAdapter();
		const published = await publishPlan(creator, { plan: plan.id }, adapter);

		const stopped = await unpublishPlan(
			creator,
			{ plan: plan.id, confirm: true },
			adapter,
		);
		assert.equal(stopped.status, "unpublished");
		assert.equal(stopped.version, published.version);
		await assert.rejects(resolvePublishedPlan(creatorId, plan.id), {
			code: "PLAN_NOT_PUBLISHED",
		});

		// The Stripe offer is archived so a leaked link cannot start a charge.
		assert.deepEqual(deactivated.sort(), [
			`price:${published.stripePriceId}`,
			`product:${published.stripeProductId}`,
		]);

		// Stopped terms survive as a superseded row, and a fresh draft copies them
		// so re-publishing is one action rather than retyping the offer.
		const versions = await versionsOf(plan.id);
		const stoppedRow = versions.find(
			(version) => version.status === "superseded",
		);
		assert.ok(stoppedRow);
		assert.ok(stoppedRow.unpublishedAt);
		assert.equal(stoppedRow.version, published.version);
		const draft = versions.find((version) => version.status === "draft");
		assert.ok(draft);
		assert.equal(draft.price, published.terms.price);
		assert.equal(draft.credits, published.terms.credits);
		assert.equal(draft.version, published.version + 1);

		// Unpublishing an unpublished plan is a no-op, not an error.
		const twice = await unpublishPlan(
			creator,
			{ plan: plan.id, confirm: true },
			adapter,
		);
		assert.equal(twice.status, "already_unpublished");
	});

	await t.test("concurrent publishes converge on one version", async () => {
		const plan = await draftPlan("Race");
		const first = stubAdapter();
		const second = stubAdapter();
		const results = await Promise.all([
			publishPlan(creator, { plan: plan.id }, first.adapter),
			publishPlan(creator, { plan: plan.id }, second.adapter),
		]);
		const versions = await versionsOf(plan.id);
		assert.equal(
			versions.filter((version) => version.status === "published").length,
			1,
		);
		// One attempt committed; the other observed it instead of superseding it.
		assert.ok(
			results.every(
				(result) =>
					result.status === "published" ||
					result.status === "already_published",
			),
		);
		assert.deepEqual(results.map((result) => result.version).sort(), [1, 1]);
	});

	await t.test("unpublishing requires explicit confirmation", async () => {
		const plan = await draftPlan("Confirm me");
		const { adapter } = stubAdapter();
		await publishPlan(creator, { plan: plan.id }, adapter);
		await assert.rejects(
			unpublishPlan(creator, { plan: plan.id }, adapter),
			/confirm/i,
		);
	});

	await t.test(
		"a planId from another creator cannot be published",
		async () => {
			const plan = await draftPlan("Mine");
			const { adapter } = stubAdapter();
			await assert.rejects(publishPlan(other, { plan: plan.id }, adapter), {
				code: "NOT_FOUND",
			});
			assert.equal((await versionsOf(plan.id))[0].status, "draft");
		},
	);

	await t.test("terms below Stripe's minimum are refused", async () => {
		const plan = await createPlan(creator, {
			name: "Too cheap",
			terms: {
				billingMode: "one_time",
				currency: "usd",
				price: 0.1,
				credits: 1,
			},
		});
		const { adapter, calls } = stubAdapter();
		await assert.rejects(publishPlan(creator, { plan: plan.id }, adapter), {
			code: "PRICE_BELOW_MINIMUM",
		});
		// Nothing was sent to Stripe for a plan that could never be charged.
		assert.equal(calls.product.length, 0);
	});

	await t.test("publishing needs a payment-ready account", async () => {
		const plan = await createPlan(other, {
			name: "No Stripe",
			terms: {
				billingMode: "one_time",
				currency: "usd",
				price: 10,
				credits: 10,
			},
		});
		const { adapter } = stubAdapter();
		await assert.rejects(publishPlan(other, { plan: plan.id }, adapter), {
			code: "PAYMENTS_NOT_READY",
		});
	});

	// Leave no rows behind for the next run.
	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, otherId));
	await db.delete(user).where(eq(user.id, studentId));
});
