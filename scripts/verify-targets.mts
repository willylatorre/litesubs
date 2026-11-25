/**
 * Preloaded by `npm test` before any suite is imported.
 *
 * Running the guard here rather than inside each suite is deliberate: a suite
 * added later cannot forget to call it, and `tsx --test lib/migrations.test.ts`
 * typed by hand still gets refused. Both `tsx` (`--import`) and plain Node
 * resolve this module, so the same entry point works for the npm script and for
 * the documented ad-hoc invocations.
 *
 * It only checks variables that are set. Offline `npm test` sets no database and
 * still runs: every database suite skips itself.
 *
 * A refusal exits non-zero here rather than throwing, because a throw would be
 * reported once per test file — twenty-odd identical stack traces instead of one
 * sentence saying which variable is wrong.
 */
import { checkEnvironment, formatRefusal } from "@/lib/verify-guard";

const result = checkEnvironment();
if (!result.safe) {
	console.error(formatRefusal(result));
	process.exit(1);
}
