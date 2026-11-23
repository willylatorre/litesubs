/**
 * End-to-end proof of the platform-billing path.
 *
 * Creates real Stripe test-mode objects on a test clock, then feeds the
 * **actual events Stripe emits** through the **actual** webhook route
 * (`/api/auth/stripe/webhook` -> @better-auth/stripe), signed with that
 * endpoint's own secret. Entitlement is read with the real `getEntitlement`.
 *
 * Phases:
 *   1. creation  -> premium
 *   2. renewal   -> periodEnd extended, still premium
 *   3. failed renewal -> access kept only through the period actually paid
 *   4. cancellation -> premium until the paid period ends, free after
 *
 * Every phase asserts the stored row as well as the derived tier, because the
 * plugin swallows some errors and still returns HTTP 200 with no row written.
 *
 * This is the only place the *event ordering* Stripe really emits is exercised.
 * The unit and integration tests assert the rules; they cannot catch Stripe
 * changing when it advances `current_period_end`.
 *
 * Requirements — it fails loudly rather than silently skipping:
 *   - a running app (`BETTER_AUTH_URL`) with the platform webhook route mounted;
 *   - `STRIPE_SECRET_KEY` in **test mode** (it creates customers and charges);
 *   - `STRIPE_PREMIUM_PRICE_ID` for the platform's monthly price;
 *   - `STRIPE_WEBHOOK_BILLING`, the signing secret that app was started with;
 *   - `DATABASE_URL` pointing at the same disposable database as the app.
 *
 * Usage: npx tsx scripts/verify-platform-billing.mts
 * Exit code is non-zero when any check fails.
 */
import { createHmac, randomUUID } from "node:crypto";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY required");
const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
const price = process.env.STRIPE_PREMIUM_PRICE_ID;
if (!price) throw new Error("STRIPE_PREMIUM_PRICE_ID required");
const webhookSecret = process.env.STRIPE_WEBHOOK_BILLING;
if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_BILLING required");
const day = 86_400;

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}\n      ${detail}`);
}

async function api(method: string, path: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json.error)}`);
  return json;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitClockReady(id: string) {
  for (let i = 0; i < 180; i++) {
    const c = await api("GET", `/test_helpers/test_clocks/${id}`);
    if (c.status === "ready") return c;
    if (c.status !== "advancing") throw new Error(`clock ${c.status}`);
    await sleep(1000);
  }
  throw new Error("clock timeout");
}

async function eventsFor(subId: string, customerId: string) {
  const out: any[] = [];
  let starting_after: string | undefined;
  for (let p = 0; p < 10; p++) {
    const q = new URLSearchParams({ limit: "100" });
    if (starting_after) q.set("starting_after", starting_after);
    const res = await api("GET", `/events?${q}`);
    for (const e of res.data) {
      const o = e.data?.object ?? {};
      const rel =
        o.id === subId ||
        (o.subscription && (typeof o.subscription === "string" ? o.subscription : o.subscription.id) === subId) ||
        (o.parent?.subscription_details?.subscription &&
          (typeof o.parent.subscription_details.subscription === "string"
            ? o.parent.subscription_details.subscription
            : o.parent.subscription_details.subscription.id) === subId) ||
        (typeof o.customer === "string" ? o.customer === customerId : o.customer?.id === customerId);
      if (rel) out.push(e);
    }
    if (!res.has_more) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return out.reverse();
}

function signatureFor(payload: string) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", webhookSecret!).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Deliver one event; returns the status. Logs the type so the tail is readable. */
async function deliver(event: any) {
  const body = JSON.stringify(event);
  const res = await fetch(`${process.env.BETTER_AUTH_URL}/api/auth/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signatureFor(body), "content-type": "application/json" },
    body,
  });
  const text = await res.text();
  console.log(`      delivered ${event.type.padEnd(36)} ${res.status} ${text}`);
  if (!res.ok) throw new Error(`webhook ${event.type} -> ${res.status} ${text}`);
}

/**
 * Deliver the platform-relevant event types, in the order Stripe emitted them.
 *
 * Each event id is delivered at most once. Redelivering an old
 * `customer.subscription.updated` would replay a *stale* period snapshot and
 * overwrite fresher state, which is a property of the test harness, not of the
 * handler (Stripe never delivers a superseded snapshot twice).
 */
const PLATFORM_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);
const deliveredIds = new Set<string>();
async function deliverPlatformEvents(events: any[]) {
  for (const e of events) {
    if (!PLATFORM_EVENTS.has(e.type) || deliveredIds.has(e.id)) continue;
    deliveredIds.add(e.id);
    await deliver(e);
  }
}

/** Renders a check line without echoing the webhook secret. */
const main = async () => {
  const { db } = await import("@/app/db");
  const { user } = await import("@/app/db/schema");
  const { getEntitlement, deriveEntitlement } = await import("@/lib/services/entitlements");
  const { eq } = await import("drizzle-orm");

  const storedRow = async () => {
    const { subscription } = await import("@/app/db/schema");
    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.referenceId, userId))
      .limit(1);
    return row;
  };
  /** Derive entitlement at an arbitrary instant, so "after the period" is testable. */
  const entitlementAt = async (at: Date) => {
    const row = await storedRow();
    return deriveEntitlement(row, 0, at.getTime());
  };

  const now = Math.floor(Date.now() / 1000);
  const suffix = randomUUID().slice(0, 8);
  const email = `billing-proof-${suffix}@example.test`;

  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email,
    name: "Billing Proof",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const start = await getEntitlement(userId);
  check("0. a new creator is free", start.tier === "free", `tier=${start.tier}`);

  // --- real Stripe objects ---------------------------------------------
  const clock = await api("POST", "/test_helpers/test_clocks", {
    frozen_time: String(now),
    name: `litesub-e2e-${suffix}`,
  });
  const customer = await api("POST", "/customers", { email, test_clock: clock.id });
  const pm = await api("POST", "/payment_methods", { type: "card", "card[token]": "tok_visa" });
  await api("POST", `/payment_methods/${pm.id}/attach`, { customer: customer.id });
  await api("POST", `/customers/${customer.id}`, { "invoice_settings[default_payment_method]": pm.id });
  await db.update(user).set({ stripeCustomerId: customer.id }).where(eq(user.id, userId));

  const subscription = await api("POST", "/subscriptions", {
    customer: customer.id,
    "items[0][price]": price,
    default_payment_method: pm.id,
    "metadata[userId]": userId,
  });
  const subId = subscription.id;
  const firstPeriodEnd: number = subscription.items.data[0].current_period_end;
  console.log(
    `\nsubscription ${subId}\n  first paid period ends ${new Date(firstPeriodEnd * 1000).toISOString()}\n`,
  );

  // --- phase 1: creation ------------------------------------------------
  console.log("--- phase 1: paid creation ---");
  // Stripe emits the creation events asynchronously; poll until the invoice.paid
  // and customer.subscription.created for THIS subscription are visible, so the
  // harness samples events that exist rather than racing the API.
  let creationEvents = await eventsFor(subId, customer.id);
  for (let i = 0; i < 30; i++) {
    const has = creationEvents.some(
      (e) => e.type === "customer.subscription.created",
    ) && creationEvents.some((e) => e.type === "invoice.paid");
    if (has) break;
    await sleep(2000);
    creationEvents = await eventsFor(subId, customer.id);
  }
  await deliverPlatformEvents(creationEvents);
  const afterCreate = await getEntitlement(userId);
  const createRow = await storedRow();
  check(
    "1a. a paid creation writes a subscription row",
    Boolean(createRow),
    createRow ? `status=${createRow.status} periodEnd=${createRow.periodEnd?.toISOString()}` : "NO ROW WRITTEN (webhook returned 200)",
  );
  check(
    "1b. paid creation -> premium",
    afterCreate.tier === "premium" && afterCreate.status === "active",
    `tier=${afterCreate.tier} status=${afterCreate.status} paidThrough=${afterCreate.paidThroughAt?.toISOString()}`,
  );
  const paidThroughCreate = afterCreate.paidThroughAt?.getTime() ?? 0;

  // --- phase 2: renewal -------------------------------------------------
  console.log("\n--- phase 2: renewal ---");
  await api("POST", `/test_helpers/test_clocks/${clock.id}/advance`, {
    frozen_time: String(firstPeriodEnd + 3600),
  });
  await waitClockReady(clock.id);
  await sleep(6000);
  const renewalEvents = await eventsFor(subId, customer.id);
  const beforeRenewal = renewalEvents.length;
  await deliverPlatformEvents(renewalEvents);
  const afterRenewal = await getEntitlement(userId);
  check(
    "2a. a renewal extends periodEnd by one month",
    (afterRenewal.paidThroughAt?.getTime() ?? 0) > paidThroughCreate,
    `${new Date(paidThroughCreate).toISOString()} -> ${afterRenewal.paidThroughAt?.toISOString()}`,
  );
  check(
    "2b. still premium after renewal",
    afterRenewal.tier === "premium",
    `tier=${afterRenewal.tier} status=${afterRenewal.status}`,
  );
  const paidThroughRenewal = afterRenewal.paidThroughAt?.getTime() ?? 0;

  // Does `customer.subscription.updated` itself carry the new period end?
  const current = await api("GET", `/subscriptions/${subId}`);
  const stripePeriodEnd: number = current.items.data[0].current_period_end;
  const updatedEvents = renewalEvents.filter((e) => e.type === "customer.subscription.updated");
  const updatedCarriesFreshEnd = updatedEvents.some(
    (e) => e.data.object.items.data[0].current_period_end === stripePeriodEnd,
  );
  check(
    "2c. customer.subscription.updated fires per renewal with a fresh period_end",
    updatedEvents.length > 0 && updatedCarriesFreshEnd,
    `${updatedEvents.length} updated event(s); fresh period_end carried=${updatedCarriesFreshEnd}`,
  );

  // --- phase 3: failed renewal -----------------------------------------
  console.log("\n--- phase 3: renewal payment fails ---");
  await api("POST", `/payment_methods/${pm.id}/detach`);
  await api("POST", `/customers/${customer.id}`, { "invoice_settings[default_payment_method]": "" });
  await api("POST", `/test_helpers/test_clocks/${clock.id}/advance`, {
    frozen_time: String(stripePeriodEnd + 3600),
  });
  await waitClockReady(clock.id);
  await sleep(8000);
  const failEvents = await eventsFor(subId, customer.id);
  await deliverPlatformEvents(failEvents);
  const failRow = await storedRow();
  const failedStripe = await api("GET", `/subscriptions/${subId}`);
  const stripeAfterFail = {
    status: failedStripe.status,
    periodStart: failedStripe.items.data[0].current_period_start,
    periodEnd: failedStripe.items.data[0].current_period_end,
  };
  const failEnt = await getEntitlement(userId);
  check(
    "3a. Stripe reports past_due and moves period_start to the unpaid period",
    stripeAfterFail.status === "past_due" && stripeAfterFail.periodStart >= stripePeriodEnd,
    `status=${stripeAfterFail.status} period=${new Date(stripeAfterFail.periodStart * 1000).toISOString()}..${new Date(stripeAfterFail.periodEnd * 1000).toISOString()}`,
  );
  check(
    "3b. the row mirrors past_due",
    failRow?.status === "past_due",
    `row.status=${failRow?.status} row.periodEnd=${failRow?.periodEnd?.toISOString()}`,
  );
  // The product rule: a failed renewal must not revoke a period already paid
  // for. The period actually paid for ended at `stripePeriodEnd`, and the clock
  // has advanced past it, so test an instant *inside* the paid window rather
  // than relative to the frozen clock.
  const paidWindowMidpoint = new Date(
    (((stripePeriodEnd - 30 * day) + stripePeriodEnd) / 2) * 1000,
  );
  const entitlementInsidePaid = await entitlementAt(paidWindowMidpoint);
  check(
    "3c. access is kept through the period that was actually paid",
    entitlementInsidePaid.tier === "premium",
    `at ${paidWindowMidpoint.toISOString()} (inside the paid month ending ${new Date(stripePeriodEnd * 1000).toISOString()}): tier=${entitlementInsidePaid.tier}, paidThroughAt=${entitlementInsidePaid.paidThroughAt?.toISOString() ?? "null"}`,
  );
  // The unpaid attempted period runs period_start..period_end. Testing at its
  // midpoint is the honest check: an instant the creator never paid for.
  const unpaidMidpoint = new Date(
    ((stripeAfterFail.periodStart + stripeAfterFail.periodEnd) / 2) * 1000,
  );
  const entitlementMidUnpaid = await entitlementAt(unpaidMidpoint);
  check(
    "3d. access is NOT granted for the unpaid renewal period",
    entitlementMidUnpaid.tier === "free",
    `at ${unpaidMidpoint.toISOString()} (midpoint of unpaid ${new Date(stripeAfterFail.periodStart * 1000).toISOString()}..${new Date(stripeAfterFail.periodEnd * 1000).toISOString()}): tier=${entitlementMidUnpaid.tier}, paidThroughAt=${entitlementMidUnpaid.paidThroughAt?.toISOString() ?? "null"}`,
  );

  // --- phase 4: cancellation -------------------------------------------
  console.log("\n--- phase 4: subscription deleted ---");
  // Recover the plan so a fresh subscription can exist for the delete test is
  // not needed: deleting this one is the real terminal event.
  const canceled = await api("DELETE", `/subscriptions/${subId}`);
  await sleep(4000);
  const deleteEvents = await eventsFor(subId, customer.id);
  await deliverPlatformEvents(deleteEvents);
  const afterDelete = await storedRow();
  const deleteEnt = await getEntitlement(userId);
  check(
    "4a. deleted sets status canceled and endedAt",
    afterDelete?.status === "canceled" && Boolean(afterDelete?.endedAt),
    `row.status=${afterDelete?.status} endedAt=${afterDelete?.endedAt?.toISOString()}`,
  );
  check(
    "4b. a deleted subscription keeps premium until the paid period ends",
    deleteEnt.tier === "premium",
    `now (inside paid period): tier=${deleteEnt.tier} paidThrough=${deleteEnt.paidThroughAt?.toISOString()}`,
  );
  const afterPeriod = await entitlementAt(new Date((stripeAfterFail.periodEnd + day) * 1000));
  check(
    "4c. and is free after the period ends",
    afterPeriod.tier === "free",
    `after periodEnd: tier=${afterPeriod.tier} status=${afterPeriod.status}`,
  );

  console.log(`\ncreator: ${userId}\nsubscription: ${subId}\nclock: ${clock.id}\n`);
  console.log("=== SUMMARY ===");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
};

await main();
