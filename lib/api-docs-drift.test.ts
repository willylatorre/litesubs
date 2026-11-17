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
const DOC_SURFACES = ["lib/llms-txt.ts", "components/integration-docs.tsx"];

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
