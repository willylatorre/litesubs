/**
 * Money reporting is a read model, so these tests pin the definitions a
 * dashboard tile cannot prove on its own: what counts as a sale, which currency
 * a total belongs to, and that refunds reduce money without inventing credits.
 *
 * Opt-in: set MCP_TEST_DATABASE_URL to a disposable PostgreSQL database.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/app/db";
import {
	payments,
	plans,
	planVersions,
	subscriptionInvoices,
	subscriptions,
	user,
} from "@/app/db/schema";
import { moneyByCurrency } from "@/lib/services/reporting";

test("money reporting uses receipts per currency and never blends them", {
	skip: !process.env.MCP_TEST_DATABASE_URL,
}, async () => {
	assert.equal(process.env.DATABASE_URL, process.env.MCP_TEST_DATABASE_URL);
	const creatorId = crypto.randomUUID();
	const otherCreatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const otherBuyerId = crypto.randomUUID();
	const accountId = `acct_${creatorId}`;

	await db.insert(user).values([
		{ id: creatorId, name: "Creator", email: `${creatorId}@example.test` },
		{
			id: otherCreatorId,
			name: "Other creator",
			email: `${otherCreatorId}@example.test`,
		},
		{ id: buyerId, name: "Buyer", email: `${buyerId}@example.test` },
		{
			id: otherBuyerId,
			name: "Other buyer",
			email: `${otherBuyerId}@example.test`,
		},
	]);
	const [plan] = await db
		.insert(plans)
		.values({ creatorId, name: "Reporting pack" })
		.returning();
	const [version] = await db
		.insert(planVersions)
		.values({
			planId: plan.id,
			creatorId,
			status: "published",
			billingMode: "one_time",
			currency: "usd",
			price: 1000,
			credits: 10,
			version: 1,
		})
		.returning();

	const receipt = (
		overrides: Partial<typeof payments.$inferInsert> & {
			id: string;
			currency: "usd" | "eur";
		},
	): typeof payments.$inferInsert => ({
		creatorId,
		userId: buyerId,
		planId: plan.id,
		planVersionId: version.id,
		stripeAccountId: accountId,
		status: "paid",
		credits: 10,
		amountTotal: 1000,
		applicationFee: 20,
		amountPaid: 1000,
		...overrides,
	});

	const [otherPlan] = await db
		.insert(plans)
		.values({ creatorId: otherCreatorId, name: "Another creator's pack" })
		.returning();
	const [otherVersion] = await db
		.insert(planVersions)
		.values({
			planId: otherPlan.id,
			creatorId: otherCreatorId,
			status: "published",
			billingMode: "one_time",
			currency: "usd",
			price: 1000,
			credits: 10,
			version: 1,
		})
		.returning();

	await db.insert(payments).values([
		// USD paid.
		receipt({ id: "pay_usd", currency: "usd" }),
		// EUR paid, same creator: must not be added to USD.
		receipt({
			id: "pay_eur",
			currency: "eur",
			amountTotal: 2000,
			amountPaid: 2000,
			applicationFee: 40,
		}),
		// EUR partially refunded: money falls, still not a new credit grant.
		receipt({
			id: "pay_eur_refunded",
			currency: "eur",
			amountTotal: 2000,
			amountPaid: 2000,
			amountRefunded: 500,
			applicationFee: 40,
		}),
		// Pending Checkout: not money.
		receipt({
			id: "pay_pending",
			currency: "usd",
			status: "pending",
			amountPaid: null,
		}),
		// Another creator's receipt: must never appear in this creator's total.
		receipt({
			id: "pay_other_creator",
			currency: "usd",
			creatorId: otherCreatorId,
			userId: otherBuyerId,
			planId: otherPlan.id,
			planVersionId: otherVersion.id,
		}),
	]);

	const creatorMoney = await moneyByCurrency({
		kind: "creator",
		id: creatorId,
	});
	assert.deepEqual(creatorMoney, [
		{
			currency: "eur",
			gross: 4000,
			refunded: 500,
			net: 3500,
			platformFees: 80,
		},
		{ currency: "usd", gross: 1000, refunded: 0, net: 1000, platformFees: 20 },
	]);

	const buyerMoney = await moneyByCurrency({ kind: "customer", id: buyerId });
	assert.deepEqual(
		buyerMoney.map((row) => [row.currency, row.net]),
		[
			["eur", 3500],
			["usd", 1000],
		],
	);

	// Scoped to one creator, the buyer's spend excludes other creators.
	const scoped = await moneyByCurrency({
		kind: "customer",
		id: buyerId,
		creatorId,
	});
	assert.equal(scoped.find((row) => row.currency === "usd")?.net, 1000);

	// Recurring invoices join the same totals per currency.
	const [monthlyPlan] = await db
		.insert(plans)
		.values({ creatorId, name: "Reporting monthly" })
		.returning();
	const [monthlyVersion] = await db
		.insert(planVersions)
		.values({
			planId: monthlyPlan.id,
			creatorId,
			status: "published",
			billingMode: "recurring",
			interval: "month",
			currency: "usd",
			price: 3000,
			credits: 5,
			version: 1,
		})
		.returning();
	const [subscription] = await db
		.insert(subscriptions)
		.values({
			creatorId,
			userId: buyerId,
			planId: monthlyPlan.id,
			planVersionId: monthlyVersion.id,
			stripeAccountId: accountId,
			stripeCustomerId: `cus_${buyerId}`,
			status: "active",
			applicationFeePercent: 2,
		})
		.returning();
	await db.insert(subscriptionInvoices).values({
		subscriptionId: subscription.id,
		stripeAccountId: accountId,
		stripeInvoiceId: `in_${crypto.randomUUID()}`,
		amountPaid: 3000,
		currency: "usd",
		periodStart: new Date(Date.now() - 1000),
		periodEnd: new Date(Date.now() + 1000),
		paidAt: new Date(),
		creditedAt: new Date(),
	});

	const withRecurring = await moneyByCurrency({
		kind: "creator",
		id: creatorId,
	});
	const usd = withRecurring.find((row) => row.currency === "usd");
	assert.equal(usd?.gross, 4000);
	assert.equal(
		usd?.platformFees,
		80,
		"recurring fee is 2% of the invoice plus the pack fee",
	);

	await db.delete(user).where(eq(user.id, creatorId));
	await db.delete(user).where(eq(user.id, otherCreatorId));
	await db.delete(user).where(eq(user.id, buyerId));
	await db.delete(user).where(eq(user.id, otherBuyerId));
});
