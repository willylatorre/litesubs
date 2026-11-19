import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * An agent's only map of this API is `/llms.txt` and `/docs`. When a route exists
 * but is undocumented, the agent concludes the capability is missing and either
 * gives up or invents a path — which is exactly what happened with webhooks:
 * they were implemented, scopable (`webhooks:manage`), and absent from both.
 *
 * This compares the real route table against both docs surfaces so a new group
 * cannot ship silently. It reads source rather than importing, because the route
 * module pulls in the database and auth stack.
 */

const ROUTE = "app/api/v1/[...resource]/route.ts";
const DOC_SURFACES = [
	"lib/llms-txt.ts",
	"components/integration-docs.tsx",
	"docs/MCP.md",
];
/** Docs whose source-file references are checked; README is prose, not a tool index. */
const FILE_SURFACES = [...DOC_SURFACES, "README.md"];

/** Groups the REST router actually answers, from its `case "METHOD group"` arms. */
async function implementedGroups() {
	const source = await readFile(ROUTE, "utf8");
	const groups = new Set<string>();
	for (const match of source.matchAll(/case "([A-Z]+) ([a-z]+)"/g))
		groups.add(match[2]);
	// Third-segment transitions (`plans/:id/publish`) are not a separate group.
	return [...groups].sort();
}

/** Groups that appear as an `/api/v1/<group>` path in a docs surface. */
async function documentedGroups() {
	const found = new Set<string>();
	for (const file of DOC_SURFACES) {
		const source = await readFile(file, "utf8");
		for (const match of source.matchAll(/\/api\/v1\/([a-z]+)/g))
			found.add(match[1]);
	}
	return [...found].sort();
}

test("every REST route group is documented for agents", async () => {
	const implemented = await implementedGroups();
	const documented = new Set(await documentedGroups());

	assert.ok(implemented.length > 0, "route table not parsed");
	const missing = implemented.filter((group) => !documented.has(group));
	assert.deepEqual(
		missing,
		[],
		`Undocumented REST groups: ${missing.join(", ")}. Add them to /llms.txt and ` +
			"the docs page, or an agent will assume the capability does not exist.",
	);
});

test("docs do not advertise a route group that was never implemented", async () => {
	// The reverse drift: a removed group left in the docs sends agents at a 404.
	const implemented = new Set(await implementedGroups());
	const documented = await documentedGroups();
	const phantom = documented.filter((group) => !implemented.has(group));
	assert.deepEqual(
		phantom,
		[],
		`Documented but unimplemented groups: ${phantom.join(", ")}`,
	);
});

/**
 * The MCP surface drifts separately from REST: a tool can exist while the docs
 * still call that capability REST-only, which tells an agent not to use a tool it
 * actually has. Extract the registered tool names from the source (importing
 * pulls in the auth stack) and require each to be named in both surfaces.
 */
test("every MCP tool is named in the agent-facing docs", async () => {
	const source = await readFile("lib/mcp-tools.ts", "utf8");
	const registered = [
		...source.matchAll(/register\(\s*\n?\s*"([a-z_]+)"/g),
	].map((match) => match[1]);
	assert.ok(registered.length > 0, "tool registry not parsed");

	for (const file of DOC_SURFACES) {
		const docs = await readFile(file, "utf8");
		const missing = registered.filter((tool) => !docs.includes(tool));
		assert.deepEqual(
			missing,
			[],
			`${file} does not name these MCP tools: ${missing.join(", ")}`,
		);
	}
});

/**
 * A doc that names a source file which no longer exists is worse than saying
 * nothing: the reader trusts a path that cannot be opened. This happened when the
 * Cal.com integration was deleted but `docs/MCP.md` still pointed at
 * `lib/cal-webhook.ts` and `lib/services/cal-bookings.ts`.
 *
 * Deliberately limited to source paths. URL routes are not checked by walking the
 * filesystem: docs legitimately name removed endpoints ("the former
 * `/api/products` adapter is gone") and partial prefixes like `/api/v1`, so a
 * resolver would report false failures and train readers to ignore it.
 */
test("docs only point at source files that exist", async () => {
	const { access } = await import("node:fs/promises");
	for (const file of FILE_SURFACES) {
		const docs = await readFile(file, "utf8");
		const paths = [
			...new Set(
				[
					...docs.matchAll(
						/(?<![\w/])((?:app|lib|components|scripts)\/[A-Za-z0-9_./-]+\.(?:tsx|ts|mjs))/g,
					),
				].map((match) => match[1]),
			),
		];
		const missing: string[] = [];
		for (const path of paths) {
			try {
				await access(path);
			} catch {
				missing.push(path);
			}
		}
		assert.deepEqual(
			missing,
			[],
			`${file} references files that do not exist: ${missing.join(", ")}`,
		);
	}
});
