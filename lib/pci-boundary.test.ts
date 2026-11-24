import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Card data must never reach this server.
 *
 * Both charge paths use Stripe **hosted Checkout**: the server creates a Session
 * and returns its `url`, and the card is entered on Stripe's page. That is what
 * keeps this product out of PCI-DSS scope for card data, and it is a property of
 * the code, not a promise in a doc.
 *
 * It was once broken by a *test probe*, not by product code: a raw card number
 * was sent to force a declined renewal. Stripe refused it (HTTP 402) and emailed
 * a first-time warning. The probe now detaches the payment method instead, which
 * reaches `past_due` without touching card data.
 *
 * This is a tripwire, not a proof: it catches the specific shapes that mean
 * "sending a PAN", because every serious regression here goes through one of
 * them. It deliberately contains no card number, so the repository never holds
 * one — including in this file.
 */

const SCANNED = ["app", "lib", "components", "scripts"];

/** Shapes that mean a caller is supplying card data to Stripe. */
const FORBIDDEN = [
	// Raw card fields in an API parameter list, e.g. "card[number]".
	"card[number]",
	"card[cvc]",
	"card[exp_month]",
	"card[exp_year]",
	// Creating a PaymentMethod from card details rather than a token.
	"payment_method_data",
	// Confirm-in-place flows that take a card server-side.
	"confirm: true,\n\t\t\tpayment_method: {",
];

async function sourceFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await sourceFiles(path)));
			continue;
		}
		if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) out.push(path);
	}
	return out;
}

test("no server code hands card data to Stripe", async () => {
	const files = (
		await Promise.all(SCANNED.map((dir) => sourceFiles(dir)))
	).flat();
	assert.ok(files.length > 50, "source scan found suspiciously few files");

	const offenders: string[] = [];
	for (const file of files) {
		// This file names the forbidden shapes in order to search for them.
		if (file.endsWith("pci-boundary.test.ts")) continue;
		const source = await readFile(file, "utf8");
		for (const shape of FORBIDDEN) {
			if (source.includes(shape)) offenders.push(`${file}: ${shape}`);
		}
	}

	assert.deepEqual(
		offenders,
		[],
		`Card data must be collected by Stripe's hosted UI, never posted here. ` +
			`Use a test token (tok_…) or a hosted Checkout Session instead:\n` +
			offenders.join("\n"),
	);
});

test("both charge paths use hosted Checkout rather than a card form", async () => {
	// The architectural property the tripwire protects: the server returns a
	// Checkout URL and never renders or accepts a card field itself.
	const direct = await readFile("lib/stripe-direct-charges.ts", "utf8");
	const sessions = direct.match(/checkout\.sessions\.create/g) ?? [];
	assert.ok(
		sessions.length >= 2,
		"one-time and recurring charges must both go through hosted Checkout",
	);
	assert.equal(
		/Stripe\.Elements|stripe-js|CardElement/.test(direct),
		false,
		"this server must not mount a card form",
	);
});
