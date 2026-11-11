import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLlmsTxt } from "@/lib/llms-txt";

test("llms.txt is a curated index with resolvable absolute links", () => {
	const text = buildLlmsTxt();
	const lines = text.split("\n");

	// Convention: single H1, summary blockquote, then linked sections.
	assert.match(lines[0], /^# \S/);
	assert.match(lines[2], /^> /);
	assert.match(text, /\n## Docs\n/);
	assert.match(text, /\n## Optional\n/);

	// A fallback URL that silently becomes "undefined/..." breaks every agent
	// that follows the index, so guard the absolute links explicitly.
	assert.doesNotMatch(text, /undefined/);
	const links = [...text.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1]);
	assert.ok(links.length > 0);
	for (const link of links) assert.match(link, /^https?:\/\/[^/\s]+/);
	assert.ok(links.some((link) => link.endsWith("/docs#quickstart")));
	assert.ok(links.some((link) => link.endsWith("/docs#mcp")));
});
