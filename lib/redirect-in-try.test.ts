import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * `redirect()` from `next/navigation` does not return — it throws an error whose
 * digest starts with `NEXT_REDIRECT`. Next.js relies on that throw to turn the
 * response into a 307.
 *
 * That makes it unsafe inside a `try` whose `catch` handles application errors:
 * the redirect is caught as a failure. Two real bugs came from this:
 *
 * - `/api/connect/oauth/start` returned `500 INTERNAL_ERROR` instead of sending
 *   the creator to Stripe, because the catch ran `errorResponse(error)`.
 * - The `/pay/[username]` checkout action caught its own successful redirect and
 *   sent the buyer to the error page, so no checkout could ever start.
 *
 * Both read correctly in review, so this guards the shape rather than the two
 * call sites: a `redirect(` that appears inside a `try` block in these files is
 * a regression. Redirect after the `try`, or return the destination.
 */

/** Functions whose catch blocks convert errors into responses or redirects. */
const FILES = [
	"app/api/connect/oauth/start/route.ts",
	"app/api/connect/oauth/callback/route.ts",
	"app/pay/[username]/page.tsx",
];

/** Match `redirect(` but not `Response.redirect(`, which is the Web API. */
const NEXT_REDIRECT_CALL = /(?<!Response\.)\bredirect\s*\(/;

/**
 * Find `redirect(` calls that sit lexically inside a `try` block (but not in the
 * `catch` that handles its errors, where redirecting to an error page is the
 * point). Parsing is line-based and only has to understand these small files.
 */
function redirectsInsideTry(source: string) {
	const lines = source.split("\n");
	const findings: { line: number; code: string }[] = [];
	// Brace depth at which each active try block started, and whether we have
	// already passed into its `catch` (where redirects are legitimate).
	const tryDepths: number[] = [];
	let inCatch = false;
	let depth = 0;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const trimmed = raw.trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

		if (/\btry\s*\{/.test(raw)) {
			depth += (raw.match(/\{/g) ?? []).length;
			tryDepths.push(depth);
			continue;
		}

		// The `catch` clause of the innermost active try opens a safe region.
		if (tryDepths.length > 0 && /^\}\s*catch\b/.test(trimmed)) {
			inCatch = true;
		}

		const opens = (raw.match(/\{/g) ?? []).length;
		const closes = (raw.match(/\}/g) ?? []).length;

		if (NEXT_REDIRECT_CALL.test(raw) && tryDepths.length > 0 && !inCatch)
			findings.push({ line: i + 1, code: trimmed });

		depth += opens - closes;
		while (tryDepths.length > 0 && depth < (tryDepths.at(-1) ?? 0)) {
			tryDepths.pop();
			inCatch = false;
		}
	}

	return findings;
}

test("redirect() is never called inside a try block whose catch handles errors", async () => {
	for (const file of FILES) {
		const source = await readFile(file, "utf8");
		const findings = redirectsInsideTry(source);
		assert.deepEqual(
			findings,
			[],
			`${file} calls redirect() inside a try block at line(s) ${findings
				.map((f) => f.line)
				.join(
					", ",
				)}. Next's redirect() throws NEXT_REDIRECT, so the catch will ` +
				"treat a successful navigation as a failure. Redirect after the try.",
		);
	}
});

test("the two fixed routes still redirect, just outside the try block", async () => {
	// Guard against "fixing" this by deleting the redirect entirely.
	const start = await readFile("app/api/connect/oauth/start/route.ts", "utf8");
	assert.match(start, /redirect\(target\)/);

	const pay = await readFile("app/pay/[username]/page.tsx", "utf8");
	assert.match(pay, /redirect\(destination\)/);
});
