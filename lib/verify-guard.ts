/**
 * Refuse to point a destructive test at a database that is not local and
 * disposable.
 *
 * Two of the suites here are not read-only. `lib/migrations.test.ts` runs
 * `DROP DATABASE` then `CREATE DATABASE` for every case, and the integration
 * suites write, update and delete real rows. Running either against production
 * would destroy it, and the failure mode is silent: the tests would pass.
 *
 * `DATABASE_URL` alone is not a safe signal. A `.env` that points `DATABASE_URL`
 * at production turns a green `npm test` into a production mutation, because the
 * suites copy it into `MCP_TEST_DATABASE_URL`. The checks below are therefore
 * structural:
 *
 *   1. Every configured database URL must resolve to a loopback host.
 *   2. Its database *name* must look disposable, so an SSH tunnel to a real host
 *      is still refused even though it presents as `localhost`.
 *   3. `MIGRATION_TEST_DATABASE_URL` must never equal `DATABASE_URL` — that is
 *      the one variable whose suite drops the database.
 *
 * The guards live in a module rather than inline so the refusal itself can be
 * tested (`lib/verify-guard.test.ts`), including the mutation case: a
 * connection string for `db.example.com/prod` must be refused.
 */

/** Hosts that are certainly this machine: a dropped database is re-creatable. */
const LOOPBACK_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]",
	"0.0.0.0",
]);

/**
 * A name is disposable when it carries a test marker as a whole word. The
 * markers are deliberately not "contains test": `litesubs_prod_testimony` must
 * not pass on the substring, while `litesubs_t065_test` must.
 *
 * `migration` is included because a database named for migration testing is
 * self-evidently scratch. A real environment is still refused first by
 * `PRODUCTION_NAME`, so `litesubs_prod_migration` cannot slip through.
 */
const DISPOSABLE_NAME =
	/(^|[_-])(test|tests|testing|verify|verification|scratch|tmp|temp|disposable|ci|migration)([_-]|$)/i;

/** A database name that is obviously one of the real environments. */
const PRODUCTION_NAME = /(^|[_-])(prod|production|live|main|primary)([_-]|$)/i;

export class UnsafeTargetError extends Error {
	readonly variable: string;
	readonly reason: string;
	readonly remedy: string;

	constructor(variable: string, reason: string, remedy: string) {
		super(
			`Refusing to run: ${variable} is not a disposable local database.\n` +
				`  ${reason}\n` +
				`  ${remedy}`,
		);
		this.name = "UnsafeTargetError";
		this.variable = variable;
		this.reason = reason;
		this.remedy = remedy;
	}
}

export type TargetCheck =
	| { safe: true; variable: string; host: string; database: string }
	| { safe: false; error: UnsafeTargetError };

/**
 * Decide whether one connection string is safe to point a destructive test at.
 * Returns a verdict instead of throwing so callers can report every unsafe
 * variable at once rather than one per run.
 */
export function checkTarget(
	variable: string,
	value: string | undefined,
): TargetCheck {
	if (!value) {
		return {
			safe: false,
			error: new UnsafeTargetError(
				variable,
				`${variable} is not set.`,
				"Point it at a disposable local database, e.g. postgresql://localhost:5432/litesubs_test.",
			),
		};
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return {
			safe: false,
			error: new UnsafeTargetError(
				variable,
				`${variable} is not a valid URL.`,
				"Pass a full postgresql:// connection string.",
			),
		};
	}

	if (!/^postgres(ql)?:$/.test(url.protocol)) {
		return {
			safe: false,
			error: new UnsafeTargetError(
				variable,
				`${variable} uses scheme "${url.protocol}", not postgresql:.`,
				"Pass a postgresql:// connection string.",
			),
		};
	}

	const host = url.hostname.toLowerCase();
	const database =
		decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)";

	if (!LOOPBACK_HOSTS.has(host)) {
		return {
			safe: false,
			error: new UnsafeTargetError(
				variable,
				`${variable} points at host "${host}", which is not this machine.`,
				"Service tests may only target localhost/127.0.0.1. A remote host cannot be assumed disposable — it may be production, a shared staging box, or a tunnel into one.",
			),
		};
	}

	if (PRODUCTION_NAME.test(database)) {
		return {
			safe: false,
			error: new UnsafeTargetError(
				variable,
				`${variable} names database "${database}", which looks like a real environment.`,
				"Recreate the database with a disposable suffix, e.g. litesubs_test.",
			),
		};
	}

	if (!DISPOSABLE_NAME.test(database)) {
		return {
			safe: false,
			error: new UnsafeTargetError(
				variable,
				`${variable} names database "${database}", which does not look disposable.`,
				'Use a name ending in "_test", "_verify" or "_scratch", so a destructive run is obviously safe. This also catches a local tunnel to a real database.',
			),
		};
	}

	return { safe: true, variable, host, database };
}

/** The variables the suites read. */
export const SERVICE_TEST_VARIABLES = [
	"DATABASE_URL",
	"MCP_TEST_DATABASE_URL",
	"MIGRATION_TEST_DATABASE_URL",
] as const;

/** The one variable whose suite drops and recreates its database. */
export const DESTRUCTIVE_VARIABLE = "MIGRATION_TEST_DATABASE_URL";

export type GuardInput = {
	/** The variables to inspect. Defaults to `process.env`. */
	env?: Record<string, string | undefined>;
};

export type GuardResult = {
	safe: boolean;
	errors: UnsafeTargetError[];
	/** Variables that were configured and therefore inspected. */
	checked: string[];
};

/**
 * Check every configured variable, then the must-differ rule.
 *
 * Unset variables are skipped rather than refused: an offline `npm test`
 * legitimately has no database, and every suite skips itself. The guard's job
 * is to refuse a target that *is* configured, not to demand one. Commands that
 * genuinely need a database use `requireDisposableTargets`.
 *
 * `MCP_TEST_DATABASE_URL === DATABASE_URL` is **allowed**, because the
 * integration suites assert that equality (16 assertions across 14 files), and
 * CI and the README both set it that way. It is not the dangerous pair: the
 * integration suites share rows, they do not drop the database. Equality with
 * production is still refused, because the shared value must itself be local and
 * disposable. It is `MIGRATION_TEST_DATABASE_URL` that must differ.
 */
export function checkEnvironment(input: GuardInput = {}): GuardResult {
	const env = input.env ?? process.env;
	const errors: UnsafeTargetError[] = [];
	const checked: string[] = [];

	for (const variable of SERVICE_TEST_VARIABLES) {
		const value = env[variable];
		if (!value) continue;
		checked.push(variable);
		const verdict = checkTarget(variable, value);
		if (!verdict.safe) errors.push(verdict.error);
	}

	const destructive = env[DESTRUCTIVE_VARIABLE];
	const databaseUrl = env.DATABASE_URL;
	if (destructive && databaseUrl && destructive === databaseUrl) {
		errors.push(
			new UnsafeTargetError(
				DESTRUCTIVE_VARIABLE,
				`${DESTRUCTIVE_VARIABLE} is identical to DATABASE_URL.`,
				"That suite runs DROP DATABASE and CREATE DATABASE for every case, so reusing DATABASE_URL would destroy the database the other suites use. Give it its own name, e.g. litesubs_migration_test.",
			),
		);
	}

	return { safe: errors.length === 0, errors, checked };
}

/** The actionable block appended to every refusal. */
export function safeTargetHelp(): string {
	return [
		"Safe local setup:",
		"  export DATABASE_URL=postgresql://localhost:5432/litesubs_test",
		"  export MCP_TEST_DATABASE_URL=$DATABASE_URL",
		"  export MIGRATION_TEST_DATABASE_URL=postgresql://localhost:5432/litesubs_migration_test",
	].join("\n");
}

export function formatRefusal(result: GuardResult): string {
	return [
		"Refusing to run the service tests against an unsafe database target.",
		"",
		...result.errors.map((error) => error.message),
		"",
		"No connection was opened and no test ran. These tests are destructive:",
		"lib/migrations.test.ts drops and recreates its database, and the integration",
		"suites write and delete rows. A green run against the wrong host is silent damage.",
		"",
		safeTargetHelp(),
	].join("\n");
}

/**
 * Throw unless every configured target is safe. `npm test` calls this through a
 * preload, so the refusal cannot be bypassed by importing one suite directly.
 */
export function assertSafeTargets(
	env: Record<string, string | undefined> = process.env,
): void {
	const result = checkEnvironment({ env });
	if (result.safe) return;
	throw new Error(formatRefusal(result));
}

/**
 * For scripts that must run against a database: assert safety *and* that the
 * required variable is present. Unlike `assertSafeTargets` this does not treat
 * "unset" as acceptable.
 */
export function requireDisposableTargets(
	variable: string,
	env: Record<string, string | undefined> = process.env,
): { host: string; database: string } {
	const value = env[variable];
	if (!value) {
		throw new Error(
			`Refusing to run: ${variable} is not set.\n` +
				"  Point it at a disposable local database.\n\n" +
				safeTargetHelp(),
		);
	}
	assertSafeTargets(env);
	const verdict = checkTarget(variable, value);
	if (!verdict.safe) throw verdict.error;
	return { host: verdict.host, database: verdict.database };
}
