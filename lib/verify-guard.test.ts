/**
 * The guard is only worth having if it actually refuses. A paragraph in a doc
 * promising "do not point this at production" is not a control; these are the
 * cases that must fail closed.
 *
 * The central case is the one the operator named: a connection string for
 * `db.example.com/prod` must be refused. If a future edit loosens the host check,
 * this fails.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkEnvironment,
	checkTarget,
	requireDisposableTargets,
	UnsafeTargetError,
} from "@/lib/verify-guard";

test("a remote production host is refused", () => {
	const verdict = checkTarget(
		"DATABASE_URL",
		"postgresql://user@db.example.com/prod",
	);
	assert.equal(verdict.safe, false);
	if (verdict.safe) return;
	assert.match(verdict.error.message, /db\.example\.com/);
	assert.match(verdict.error.message, /not this machine/);
});

test("a production-looking database on localhost is still refused", () => {
	// A loopback host is necessary but not sufficient: an SSH tunnel to a real
	// database presents as localhost.
	const verdict = checkTarget(
		"DATABASE_URL",
		"postgresql://localhost:5432/litesubs_prod",
	);
	assert.equal(verdict.safe, false);
	if (verdict.safe) return;
	assert.match(verdict.error.message, /looks like a real environment/);
});

test("a local database without a disposable marker is refused", () => {
	const verdict = checkTarget(
		"DATABASE_URL",
		"postgresql://localhost:5432/litesubs",
	);
	assert.equal(verdict.safe, false);
	if (verdict.safe) return;
	assert.match(verdict.error.message, /does not look disposable/);
});

test("a database name containing 'test' as a substring is not enough", () => {
	// `litesubs_prod_testimony` must not pass on the substring "test".
	const verdict = checkTarget(
		"DATABASE_URL",
		"postgresql://localhost:5432/litesubs_prod_testimony",
	);
	assert.equal(verdict.safe, false);
});

test("a disposable local database is allowed", () => {
	for (const name of [
		"litesubs_test",
		"litesubs_t065_test",
		"litesubs_verify",
		"litesubs_scratch",
		"test",
	]) {
		const verdict = checkTarget(
			"DATABASE_URL",
			`postgresql://localhost:5432/${name}`,
		);
		assert.equal(verdict.safe, true, `${name} should be allowed`);
	}
});

test("127.0.0.1 is treated as local", () => {
	const verdict = checkTarget(
		"DATABASE_URL",
		"postgresql://127.0.0.1:5432/litesubs_test",
	);
	assert.equal(verdict.safe, true);
});

test("a non-postgres scheme is refused", () => {
	const verdict = checkTarget(
		"DATABASE_URL",
		"mysql://localhost:3306/litesubs_test",
	);
	assert.equal(verdict.safe, false);
});

test("a malformed connection string is refused rather than crashing", () => {
	const verdict = checkTarget("DATABASE_URL", "not a url");
	assert.equal(verdict.safe, false);
	if (verdict.safe) return;
	assert.match(verdict.error.message, /not a valid URL/);
});

/**
 * The migration suite drops and recreates its database. Reusing DATABASE_URL for
 * it would delete the database the other suites are mid-way through using.
 */
test("MIGRATION_TEST_DATABASE_URL equal to DATABASE_URL is refused", () => {
	const shared = "postgresql://localhost:5432/litesubs_test";
	const result = checkEnvironment({
		env: {
			DATABASE_URL: shared,
			MCP_TEST_DATABASE_URL: shared,
			MIGRATION_TEST_DATABASE_URL: shared,
		},
	});
	assert.equal(result.safe, false);
	assert.ok(
		result.errors.some(
			(error) => error.variable === "MIGRATION_TEST_DATABASE_URL",
		),
		"the refusal must name MIGRATION_TEST_DATABASE_URL, not just DATABASE_URL",
	);
});

/**
 * `MCP_TEST_DATABASE_URL === DATABASE_URL` is allowed on purpose: the integration
 * suites assert the equality in sixteen places, and CI and the README set it that
 * way. It is not the dangerous pair because those suites share rows rather than
 * dropping the database.
 */
test("MCP_TEST_DATABASE_URL may equal DATABASE_URL", () => {
	const shared = "postgresql://localhost:5432/litesubs_test";
	const result = checkEnvironment({
		env: {
			DATABASE_URL: shared,
			MCP_TEST_DATABASE_URL: shared,
			MIGRATION_TEST_DATABASE_URL:
				"postgresql://localhost:5432/litesubs_migration_test",
		},
	});
	assert.equal(
		result.safe,
		true,
		result.errors.map((e) => e.message).join("\n"),
	);
});

/**
 * The production case the operator must be protected from: the integration
 * suites copy DATABASE_URL into MCP_TEST_DATABASE_URL, so a `.env` pointed at
 * production would otherwise be a green run that mutates production.
 */
test("a production DATABASE_URL is refused even when the suites copy it everywhere", () => {
	const prod = "postgresql://user@db.example.com/prod";
	const result = checkEnvironment({
		env: {
			DATABASE_URL: prod,
			MCP_TEST_DATABASE_URL: prod,
			MIGRATION_TEST_DATABASE_URL:
				"postgresql://localhost:5432/litesubs_migration_test",
		},
	});
	assert.equal(result.safe, false);
	assert.ok(result.errors.length >= 1);
});

test("an unset environment is not a refusal, so offline npm test still runs", () => {
	const result = checkEnvironment({ env: {} });
	assert.equal(result.safe, true);
	assert.deepEqual(result.checked, []);
});

test("requireDisposableTargets refuses a missing variable with a clear message", () => {
	assert.throws(
		() => requireDisposableTargets("MIGRATION_TEST_DATABASE_URL", {}),
		/MIGRATION_TEST_DATABASE_URL is not set/,
	);
});

test("the refusal is an error with an actionable remedy, not a silent skip", () => {
	const verdict = checkTarget(
		"DATABASE_URL",
		"postgresql://user@db.example.com/prod",
	);
	assert.equal(verdict.safe, false);
	if (verdict.safe) return;
	assert.ok(verdict.error instanceof UnsafeTargetError);
	assert.ok(verdict.error.remedy.length > 0, "a refusal must say what to do");
	assert.match(verdict.error.message, /Refusing to run/);
});
