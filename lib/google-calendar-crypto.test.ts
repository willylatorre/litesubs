/**
 * Token-at-rest protection is the security boundary of this slice: a leak here
 * is a permanent calendar compromise, and a silent fallback to plaintext is
 * worse than not working at all. These tests need no database and no network.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
	decryptToken,
	encryptToken,
	isEncryptedToken,
	isTokenEncryptionConfigured,
	secureEquals,
	TokenCryptoError,
} from "@/lib/google-calendar-crypto";

const KEY = "a".repeat(64); // 64 hex chars = 32 bytes
const OTHER_KEY = "b".repeat(64);

const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
	process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
	if (originalKey === undefined) {
		delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
	} else {
		process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
	}
});

test("a token round-trips through encrypt/decrypt", () => {
	const secret = "ya29.a0AfH6SMB-example-access-token";
	const envelope = encryptToken(secret);

	assert.notEqual(envelope, secret);
	assert.ok(!envelope.includes(secret));
	assert.ok(isEncryptedToken(envelope));
	assert.equal(decryptToken(envelope), secret);
});

test("encrypting the same token twice produces different ciphertexts", () => {
	// A random IV per call: equal ciphertexts would leak that two tokens match.
	const secret = "refresh-token-value";
	const first = encryptToken(secret);
	const second = encryptToken(secret);

	assert.notEqual(first, second);
	assert.equal(decryptToken(first), secret);
	assert.equal(decryptToken(second), secret);
});

test("a different key cannot decrypt the token", () => {
	const envelope = encryptToken("sensitive-refresh-token");
	process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = OTHER_KEY;

	assert.throws(
		() => decryptToken(envelope),
		(error: unknown) =>
			error instanceof TokenCryptoError && error.code === "decrypt_failed",
	);
});

test("tampered ciphertext is rejected", () => {
	const envelope = encryptToken("sensitive-refresh-token");
	const parts = envelope.split(".");
	// Flip a bit in the decoded ciphertext rather than the last base64url
	// character: the final character can encode only padding bits, so flipping it
	// may leave the decoded bytes identical and the "tampered" input would decrypt
	// successfully. That made this test fail intermittently.
	const bytes = Buffer.from(parts[3], "base64url");
	bytes[0] = (bytes[0] ?? 0) ^ 0x01;
	parts[3] = bytes.toString("base64url");

	assert.throws(
		() => decryptToken(parts.join(".")),
		(error: unknown) =>
			error instanceof TokenCryptoError && error.code === "decrypt_failed",
	);
});

test("a tampered auth tag is rejected", () => {
	const envelope = encryptToken("sensitive-refresh-token");
	const parts = envelope.split(".");
	parts[2] = Buffer.alloc(16, 0).toString("base64url");

	assert.throws(
		() => decryptToken(parts.join(".")),
		(error: unknown) =>
			error instanceof TokenCryptoError && error.code === "decrypt_failed",
	);
});

test("a missing key fails closed instead of storing plaintext", () => {
	delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

	assert.equal(isTokenEncryptionConfigured(), false);
	assert.throws(
		() => encryptToken("token"),
		(error: unknown) =>
			error instanceof TokenCryptoError && error.code === "missing_key",
	);
});

test("an invalid key length is rejected, not padded", () => {
	process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "too-short";

	assert.equal(isTokenEncryptionConfigured(), false);
	assert.throws(
		() => encryptToken("token"),
		(error: unknown) =>
			error instanceof TokenCryptoError && error.code === "invalid_key",
	);
});

test("a key supplied as base64 works the same as hex", () => {
	const base64Key = Buffer.alloc(32, 7).toString("base64");
	process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = base64Key;

	assert.equal(isTokenEncryptionConfigured(), true);
	const envelope = encryptToken("token-from-base64-key");
	assert.equal(decryptToken(envelope), "token-from-base64-key");
});

test("malformed envelopes are rejected without throwing a decrypt error", () => {
	assert.throws(
		() => decryptToken("not-an-envelope"),
		(error: unknown) =>
			error instanceof TokenCryptoError &&
			error.code === "malformed_ciphertext",
	);
	assert.throws(
		() => decryptToken("v2.aaaa.bbbb.cccc"),
		(error: unknown) =>
			error instanceof TokenCryptoError &&
			error.code === "malformed_ciphertext",
	);
});

test("error messages never contain the secret", () => {
	process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = OTHER_KEY;
	const envelope = encryptToken("super-secret-token-value");

	try {
		decryptToken(envelope);
		assert.fail("expected decryptToken to throw");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		assert.ok(!message.includes("super-secret-token-value"));
		assert.ok(!message.includes(KEY));
	}
});

test("secureEquals compares state values without a length oracle", () => {
	assert.equal(secureEquals("abc", "abc"), true);
	assert.equal(secureEquals("abc", "abd"), false);
	assert.equal(secureEquals("abc", "abcd"), false);
});
