import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import Stripe from "stripe";

if (!process.argv.includes("--sandbox-only")) throw new Error("Pass --sandbox-only to approve temporary test fixtures.");
const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!/^(sk|rk)_test_/.test(key)) throw new Error("Refusing checkout test without a Stripe sandbox key.");
if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_URL) throw new Error("Run this inside the configured app container.");
const base = new URL(process.env.BETTER_AUTH_URL).origin;
const stripe = new Stripe(key, { apiVersion: "2026-10-28.endive", timeout:20000, maxNetworkRetries:0 });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis:10000, query_timeout:10000 });
const emails = [];
let sessionId;
let expired = false;
let failure;
const cleanupErrors = [];

await client.connect();
try {
	const creator = await signup("creator");
	const student = await signup("student");
	const plan = await request("/api/v1/plans", creator.cookie, { name: "Disposable MCP sandbox plan", price: 1, credits: 3, currency: "usd" });
	assert.equal(plan.price, 100);
	const enrollment = await request("/api/v1/enrollments", creator.cookie, { customer: student.email, plan: plan.id, mode: "invoice" });
	assert.equal(enrollment.status, "awaiting_payment");
	sessionId = enrollment.paymentUrl.match(/cs_test_[a-zA-Z0-9]+/)?.[0];
	assert.ok(sessionId, "Expected a sandbox Checkout Session URL");
	const session = await stripe.checkout.sessions.retrieve(sessionId);
	assert.equal(session.livemode, false);
	assert.equal(session.amount_total, 100);
	assert.equal(session.payment_status, "unpaid");
	assert.equal(session.metadata.creatorId, creator.id);
	assert.equal(session.metadata.userId, student.id);
	assert.equal(session.metadata.productId, plan.id);
	const details = await request(`/api/v1/customers/${student.id}`, creator.cookie);
	assert.equal(details.subscriptions[0].credits, 0, "No credits may be granted before payment");
	const result = await stripe.checkout.sessions.expire(sessionId);
	assert.equal(result.status, "expired");
	expired = true;
} catch (error) { failure = new Error(safeMessage(error)); }
finally {
	try {
		if (sessionId && !expired) {
			try { await stripe.checkout.sessions.expire(sessionId); } catch (error) { cleanupErrors.push(safeMessage(error)); }
		}
		// Only these two exact, cryptographically random fixture emails are
		// eligible for cleanup. No existing users or customers are selected.
		for (const email of emails) {
			try {
				const customers = await stripe.customers.list({ email, limit: 100 });
				for (const customer of customers.data) await stripe.customers.del(customer.id);
			} catch (error) { cleanupErrors.push(safeMessage(error)); }
		}
		await client.query('DELETE FROM public."user" WHERE email = ANY($1)', [emails]);
		const { rows: [remaining] } = await client.query('SELECT count(*)::int AS count FROM public."user" WHERE email = ANY($1)', [emails]);
		assert.equal(remaining.count, 0);
	} finally { await client.end(); }
}
if (failure && cleanupErrors.length) throw new Error(`${failure.message}; sandbox cleanup was incomplete: ${cleanupErrors.join("; ")}`);
if (failure) throw failure;
if (cleanupErrors.length) throw new Error(`Sandbox cleanup was incomplete: ${cleanupErrors.join("; ")}`);
console.log("Sandbox invoice enrollment passed: $1 unpaid checkout, correct customer/plan metadata, zero credits before payment, checkout expired, app fixtures and Stripe test customers removed. No payment was made.");

async function signup(kind) {
	const email = `litesubs-smoke-${randomBytes(16).toString("hex")}@example.com`;
	const { rows } = await client.query('SELECT id FROM public."user" WHERE email = $1', [email]);
	assert.equal(rows.length, 0);
	emails.push(email);
	const response = await fetch(`${base}/api/auth/sign-up/email`, { method: "POST", signal:AbortSignal.timeout(30000), headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ name: `Disposable MCP smoke ${kind}`, email, password: randomBytes(24).toString("base64url") }) });
	const data = await response.json();
	if (!response.ok) throw new Error(`Sandbox signup failed (${response.status}): ${data.error ?? data.message ?? "request rejected"}`);
	const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
	assert.ok(cookie, "Signup must issue a session cookie");
	assert.equal(data.user.email, email);
	return { id: data.user.id, email, cookie };
}

async function request(path, cookie, body) {
	const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", signal:AbortSignal.timeout(30000), headers: { cookie, origin: base, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
	const data = await response.json();
	if (!response.ok) throw new Error(`Sandbox app request ${path} failed (${response.status}): ${data.error ?? "request rejected"}`);
	return data;
}

function safeMessage(error) {
	return String(error?.message ?? "Unknown sandbox error").replace(/\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9_*]+/g, "[REDACTED Stripe key]");
}
