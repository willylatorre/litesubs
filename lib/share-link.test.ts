/**
 * Sharing is the last step before a creator can actually deliver a link, and it
 * has three different failure modes that all look like success from the UI:
 * a dismissed share sheet, a missing share sheet, and a clipboard the browser
 * refuses. These tests pin which one the caller is told about.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { copyToClipboard, rehostUrl, shareLink } from "@/lib/share-link";

function withNavigator<T>(
	stub: Record<string, unknown>,
	run: () => Promise<T>,
) {
	const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	Object.defineProperty(globalThis, "navigator", {
		value: stub,
		configurable: true,
	});
	return run().finally(() => {
		if (original) Object.defineProperty(globalThis, "navigator", original);
		else delete (globalThis as { navigator?: unknown }).navigator;
	});
}

test("rehosting keeps the canonical path but uses the browsing deployment", () => {
	assert.equal(
		rehostUrl(
			"https://litesubs.com/invite/ana/abc-123",
			"https://litesubs-git-fix-ana.vercel.app",
		),
		"https://litesubs-git-fix-ana.vercel.app/invite/ana/abc-123",
	);
	// Production against production is a no-op, so nothing changes for real users.
	assert.equal(
		rehostUrl("https://litesubs.com/invite/ana/abc", "https://litesubs.com"),
		"https://litesubs.com/invite/ana/abc",
	);
	// Query strings and fragments are part of the link, not decoration.
	assert.equal(
		rehostUrl(
			"http://localhost:3000/invite/t?x=1#top",
			"http://localhost:3001",
		),
		"http://localhost:3001/invite/t?x=1#top",
	);
});

test("rehosting never invents a URL for unparsable input", () => {
	assert.equal(rehostUrl("not a url", "also not a url"), "not a url");
});

test("the share sheet is used when the browser has one", async () => {
	let shared: ShareData | undefined;
	const result = await withNavigator(
		{
			share: async (data: ShareData) => {
				shared = data;
			},
			clipboard: { writeText: async () => assert.fail("must not copy") },
		},
		() => shareLink({ url: "https://litesubs.com/invite/ana/tok", title: "t" }),
	);

	assert.equal(result, "shared");
	assert.equal(shared?.url, "https://litesubs.com/invite/ana/tok");
});

test("dismissing the share sheet is not a failure and does not copy", async () => {
	const result = await withNavigator(
		{
			share: async () => {
				throw new DOMException("cancelled", "AbortError");
			},
			clipboard: { writeText: async () => assert.fail("must not copy") },
		},
		() => shareLink({ url: "https://example.com/invite/t" }),
	);

	assert.equal(result, "cancelled");
});

test("a desktop browser without a share sheet falls back to the clipboard", async () => {
	let copied = "";
	const result = await withNavigator(
		{
			clipboard: {
				writeText: async (text: string) => {
					copied = text;
				},
			},
		},
		() => shareLink({ url: "https://example.com/invite/t" }),
	);

	assert.equal(result, "copied");
	assert.equal(copied, "https://example.com/invite/t");
});

test("a share sheet that rejects still tries the clipboard", async () => {
	const result = await withNavigator(
		{
			share: async () => {
				throw new Error("NotAllowedError: no user gesture");
			},
			clipboard: { writeText: async () => undefined },
		},
		() => shareLink({ url: "https://example.com/invite/t" }),
	);

	assert.equal(result, "copied");
});

test("a refused clipboard is reported, not swallowed", async () => {
	const result = await withNavigator(
		{
			clipboard: {
				writeText: async () => {
					throw new Error("denied");
				},
			},
		},
		() => shareLink({ url: "https://example.com/invite/t" }),
	);

	assert.equal(result, "failed");
	assert.equal(
		await withNavigator({ clipboard: undefined }, () => copyToClipboard("x")),
		false,
	);
});
