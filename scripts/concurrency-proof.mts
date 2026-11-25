/**
 * T066 proof: the money path under *process*-level concurrency.
 *
 * `lib/concurrency.integration.test.ts` covers the same guarantees inside one
 * node process, where `Promise.all` over the pool gives real parallel
 * transactions. This script removes the last shared thing — the process — by
 * spawning several children that each open their own pool and hit the same
 * service with the same id. Nothing but PostgreSQL is shared, so a pass cannot be
 * an artefact of one connection queueing the others.
 *
 * Run with a disposable database:
 *   set -a; . ./.env; . ./.env.test; set +a
 *   npx tsx scripts/concurrency-proof.mts
 *
 * The child mode is this same file with `--child <mode> <json>`; it exists so the
 * parent and the racer cannot drift apart in how they call the service.
 */
import { spawn } from "node:child_process";
import { and, eq } from "drizzle-orm";

const [mode, payload] = process.argv.slice(2);

// ---------------------------------------------------------------- child mode
if (mode === "--child") {
	const { db } = await import("../app/db");
	const { fulfillPayment } = await import("../lib/services/purchase");
	const { createGrant } = await import("../lib/services/credits");
	const input = JSON.parse(payload) as
		| { kind: "checkout"; checkoutSessionId: string }
		| {
				kind: "grant";
				enrollmentId: string;
				creatorId: string;
				userId: string;
				planId: string;
				entryId: string;
		  };

	if (input.kind === "checkout") {
		const result = await fulfillPayment({
			checkoutSessionId: input.checkoutSessionId,
			amountPaid: 1000,
		});
		console.log(result.status);
	} else {
		try {
			const result = await db.transaction((tx) =>
				createGrant(tx, {
					enrollmentId: input.enrollmentId,
					creatorId: input.creatorId,
					userId: input.userId,
					planId: input.planId,
					sourceTransactionId: input.entryId,
					kind: "purchase",
					amount: 10,
				}),
			);
			console.log(result.duplicate ? "duplicate" : "inserted");
		} catch (error) {
			console.log(`error:${(error as Error).name}`);
		}
	}
	process.exit(0);
}

// --------------------------------------------------------------- parent mode
const { db } = await import("../app/db");
const schema = await import("../app/db/schema");
const { connectedAccounts } = await import("../app/db/stripe-connect-schema");
const { usableBalance } = await import("../lib/services/credits");
const { createPlan } = await import("../lib/services/plans");
const { sessionPrincipal } = await import("../lib/services/principal");
const { startPurchase } = await import("../lib/services/purchase");
const { publishPlan } = await import("../lib/services/publish");
const { grantTestPremium } = await import("../lib/test-premium");

const {
	creditGrants,
	enrollments,
	payments,
	transactions,
	user,
} = schema;

const RACERS = 6;

const offerAdapter = {
	createProduct: async () => ({ id: "prod_proof" }),
	createPrice: async () => ({ id: "price_proof" }),
	deactivateProduct: async () => {},
	deactivatePrice: async () => {},
};

let sessionSeq = 0;
const checkoutAdapter = {
	async createConnectedCustomer(input: {
		stripeAccountId: string;
		email: string;
	}) {
		return { id: `cus_${input.stripeAccountId}_${input.email}` };
	},
	async createDirectCheckoutSession() {
		sessionSeq += 1;
		return {
			id: `cs_proof_${process.pid}_${Date.now()}_${sessionSeq}`,
			url: `https://checkout.test/${sessionSeq}`,
		} as never;
	},
};

/** Launch N children at once and collect their one-line verdicts. */
function race(childPayload: object): Promise<string[]> {
	const arg = JSON.stringify(childPayload);
	return Promise.all(
		Array.from(
			{ length: RACERS },
			() =>
				new Promise<string>((resolve, reject) => {
					const child = spawn(
						process.execPath,
						["--import", "tsx", new URL(import.meta.url).pathname, "--child", arg],
						{ env: process.env, stdio: ["ignore", "pipe", "pipe"] },
					);
					let out = "";
					let err = "";
					child.stdout.on("data", (chunk) => {
						out += chunk;
					});
					child.stderr.on("data", (chunk) => {
						err += chunk;
					});
					child.on("close", (code) =>
						code === 0
							? resolve(out.trim())
							: reject(new Error(`child exited ${code}: ${err || out}`)),
					);
				}),
		),
	);
}

async function fixture(label: string) {
	const creatorId = crypto.randomUUID();
	const buyerId = crypto.randomUUID();
	const stripeAccountId = `acct_proof_${label}_${crypto.randomUUID().slice(0, 8)}`;
	await db.insert(user).values([
		{ id: creatorId, name: `C ${label}`, email: `${creatorId}@example.test` },
		{ id: buyerId, name: `B ${label}`, email: `${buyerId}@example.test` },
	]);
	await grantTestPremium(creatorId);
	await db.insert(connectedAccounts).values({
		userId: creatorId,
		stripeAccountId,
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
	const creator = sessionPrincipal(creatorId);
	const plan = await createPlan(creator, {
		name: `Proof ${label}`,
		terms: { billingMode: "one_time", currency: "usd", price: 10, credits: 10 },
	});
	await publishPlan(creator, { plan: plan.id }, offerAdapter);
	return { creatorId, buyerId, creator, plan };
}

async function newCheckout(f: Awaited<ReturnType<typeof fixture>>) {
	const started = await startPurchase(
		f.creator,
		{ planId: f.plan.id, userId: f.buyerId },
		checkoutAdapter as never,
	);
	const payment = await db.query.payments.findFirst({
		where: eq(payments.id, started.paymentId as string),
	});
	if (!payment?.stripeCheckoutId) throw new Error("checkout has no session id");
	return payment.stripeCheckoutId;
}

const cleanup = async (...ids: string[]) => {
	for (const id of ids) await db.delete(user).where(eq(user.id, id));
};

const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL");

// 1. N processes deliver ONE checkout at once: exactly one must grant.
{
	const f = await fixture("checkout");
	const checkoutSessionId = await newCheckout(f);
	const outcomes = await race({ kind: "checkout", checkoutSessionId });
	const grants = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.creatorId, f.creatorId));
	const ledger = await db
		.select()
		.from(transactions)
		.where(eq(transactions.creatorId, f.creatorId));
	const enrollment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, f.buyerId),
			eq(enrollments.planId, f.plan.id),
		),
	});
	const balance = enrollment ? await usableBalance(db, enrollment.id) : -1;
	console.log(`\n1. ${RACERS} PROCESSES deliver ONE checkout simultaneously`);
	console.log(`   child outcomes: ${outcomes.sort().join(",")}`);
	console.log(
		`   grants=${grants.length} ledger=${ledger.length} usable=${balance} projection=${enrollment?.credits}`,
	);
	console.log(
		`   ${verdict(grants.length === 1 && ledger.length === 1 && balance === 10)} exactly one grant`,
	);
	await cleanup(f.creatorId, f.buyerId);
}

// 2. N processes deliver N DIFFERENT checkouts at once: N grants.
{
	const f = await fixture("distinct");
	const sessions: string[] = [];
	for (let i = 0; i < RACERS; i += 1) sessions.push(await newCheckout(f));
	await Promise.all(
		sessions.map((checkoutSessionId) =>
			race({ kind: "checkout", checkoutSessionId }),
		),
	);
	const grants = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.creatorId, f.creatorId));
	const enrollment = await db.query.enrollments.findFirst({
		where: and(
			eq(enrollments.userId, f.buyerId),
			eq(enrollments.planId, f.plan.id),
		),
	});
	const balance = enrollment ? await usableBalance(db, enrollment.id) : -1;
	console.log(`\n2. ${RACERS} PROCESSES deliver ${RACERS} DIFFERENT checkouts`);
	console.log(
		`   grants=${grants.length} usable=${balance} projection=${enrollment?.credits}`,
	);
	console.log(
		`   ${verdict(grants.length === RACERS && balance === RACERS * 10)} one grant per payment`,
	);
	await cleanup(f.creatorId, f.buyerId);
}

// 3. N processes insert a grant for ONE ledger row: the constraint decides.
{
	const f = await fixture("unique");
	const [enrollment] = await db
		.insert(enrollments)
		.values({ creatorId: f.creatorId, userId: f.buyerId, planId: f.plan.id })
		.returning();
	const [entry] = await db
		.insert(transactions)
		.values({
			creatorId: f.creatorId,
			userId: f.buyerId,
			planId: f.plan.id,
			amount: 10,
			type: "purchase",
			status: "completed",
		})
		.returning({ id: transactions.id });
	const outcomes = await race({
		kind: "grant",
		enrollmentId: enrollment.id,
		creatorId: f.creatorId,
		userId: f.buyerId,
		planId: f.plan.id,
		entryId: entry.id,
	});
	const grants = await db
		.select()
		.from(creditGrants)
		.where(eq(creditGrants.sourceTransactionId, entry.id));
	console.log(`\n3. ${RACERS} PROCESSES createGrant ONE source ledger row`);
	console.log(`   child outcomes: ${outcomes.sort().join(",")}`);
	console.log(`   grants for that row: ${grants.length}`);
	console.log(`   ${verdict(grants.length === 1)} unique constraint held`);
	await cleanup(f.creatorId, f.buyerId);
}

process.exit(0);
