/**
 * Prove the Premium checkout request Stripe actually receives, rather than the
 * object a unit test says it builds.
 *
 * Signs up a disposable creator on the local sandbox app, asks the real
 * `/subscription/upgrade` endpoint for a Checkout URL, and reads the Session back
 * from Stripe. The assertions are the ones that decide whether tax is collected:
 * `automatic_tax` present, tax ids accepted, and the amount still the $5 price.
 *
 * It makes no payment: it only creates an unpaid session and expires it.
 *
 * Requires a running dev server on `BETTER_AUTH_URL` with this branch's code, a
 * migrated disposable database, and the sandbox Price/secret. The sandbox
 * account also needs a `tax/settings` head office — without one, Stripe answers
 * the upgrade with 400 "You must have a valid head office address to enable
 * automatic tax calculation in test mode". See `docs/PLATFORM-BILLING.md`.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const base = process.env.BETTER_AUTH_URL;
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!base) throw new Error("BETTER_AUTH_URL required");
if (!/^(sk|rk)_test_/.test(key)) throw new Error("Refusing: needs a sandbox key");

const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
async function stripe(path: string) {
	const res = await fetch(`https://api.stripe.com/v1${path}`, {
		headers: { Authorization: auth },
	});
	const json = await res.json();
	if (!res.ok) throw new Error(`${path} -> ${res.status}`);
	return json;
}

const email = `tax-probe-${randomBytes(8).toString("hex")}@example.test`;
const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
	method: "POST",
	headers: { "content-type": "application/json", origin: base },
	body: JSON.stringify({
		name: "Tax probe",
		email,
		password: randomBytes(18).toString("base64url"),
	}),
});
assert.ok(signUp.ok, `signup failed ${signUp.status}`);
const cookie = signUp.headers
	.getSetCookie()
	.map((v) => v.split(";")[0])
	.join("; ");

const upgrade = await fetch(`${base}/api/auth/subscription/upgrade`, {
	method: "POST",
	headers: { "content-type": "application/json", origin: base, cookie },
	body: JSON.stringify({
		plan: "premium",
		successUrl: `${base}/dashboard/billing?upgraded=true`,
		cancelUrl: `${base}/dashboard/billing?canceled=true`,
		returnUrl: `${base}/dashboard/billing`,
		disableRedirect: true,
	}),
});
const body = await upgrade.json();
assert.ok(upgrade.ok && body.url, `upgrade failed ${upgrade.status}`);
assert.match(body.url, /checkout\.stripe\.com/, "expected a hosted Checkout URL");

const sessionId = body.url.match(/cs_test_[A-Za-z0-9]+/)?.[0];
assert.ok(sessionId, "expected a Checkout Session id in the URL");
const session = await stripe(`/checkout/sessions/${sessionId}`);

console.log(
	JSON.stringify(
		{
			livemode: session.livemode,
			mode: session.mode,
			amount_total: session.amount_total,
			currency: session.currency,
			automatic_tax_status: session.automatic_tax?.status,
			automatic_tax_enabled: session.automatic_tax?.enabled,
			tax_id_collection_enabled: session.tax_id_collection?.enabled,
			line_items: session.line_items,
			customer: session.customer,
			customer_email: session.customer_email,
		},
		null,
		2,
	),
);

assert.equal(session.automatic_tax.enabled, true, "automatic_tax must be on");
assert.equal(session.tax_id_collection.enabled, true, "tax ids must be collectable");
assert.equal(session.mode, "subscription");
assert.equal(session.amount_total, 500, "price must still be $5");

await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
	method: "POST",
	headers: { Authorization: auth },
});

const customers = await stripe(`/customers?email=${encodeURIComponent(email)}`);
for (const customer of customers.data)
	await fetch(`https://api.stripe.com/v1/customers/${customer.id}`, {
		method: "DELETE",
		headers: { Authorization: auth },
	});

console.log("PASS Premium checkout sends automatic_tax and tax_id_collection");
