import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

/**
 * AES-256-GCM encryption for Google Calendar tokens at rest.
 *
 * Fails closed: a missing or malformed `GOOGLE_TOKEN_ENCRYPTION_KEY` throws
 * instead of writing plaintext. That is deliberate — a deployment that forgets
 * the key cannot connect a calendar, but it can never leak a refresh token by
 * silently storing one in the clear.
 *
 * The key is read on every call (not cached at import time) so tests can set it
 * per test and so a rotated key takes effect without a rebuild. It must be 32
 * bytes, supplied as either 64 hex characters or base64.
 *
 * Never include the key, the plaintext, or the ciphertext in an error message:
 * callers may surface these errors to users.
 */

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Additional authenticated data binds a ciphertext to this purpose. A token
 * encrypted for another feature cannot be decrypted as a calendar token even if
 * both use the same key.
 */
const AAD = Buffer.from("litesubs:google-calendar-token:v1", "utf8");

export class TokenCryptoError extends Error {
	readonly code:
		| "missing_key"
		| "invalid_key"
		| "malformed_ciphertext"
		| "decrypt_failed";

	constructor(
		code: TokenCryptoError["code"],
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "TokenCryptoError";
		this.code = code;
	}
}

function decodeKey(raw: string): Buffer {
	const trimmed = raw.trim();
	const candidate =
		/^[0-9a-fA-F]{64}$/.test(trimmed) && trimmed.length === 64
			? Buffer.from(trimmed, "hex")
			: Buffer.from(trimmed, "base64");

	if (candidate.length !== 32) {
		throw new TokenCryptoError(
			"invalid_key",
			"GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64).",
		);
	}

	return candidate;
}

/** The configured key, or `null` when encryption is not available. */
function encryptionKey(): Buffer | null {
	const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
	if (!raw || raw.trim() === "") return null;
	return decodeKey(raw);
}

/** Whether a usable key is present. Never throws. */
export function isTokenEncryptionConfigured(): boolean {
	try {
		return encryptionKey() !== null;
	} catch {
		return false;
	}
}

/**
 * Whether a value looks like an envelope produced by {@link encryptToken}.
 * Safe to call on untrusted input.
 */
export function isEncryptedToken(value: string): boolean {
	return value.startsWith(`${ENVELOPE_VERSION}.`);
}

/** Encrypt a token for storage. Throws {@link TokenCryptoError} if no key. */
export function encryptToken(plaintext: string): string {
	const key = encryptionKey();
	if (!key) {
		throw new TokenCryptoError(
			"missing_key",
			"Google token encryption is not configured.",
		);
	}

	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, key, iv, {
		authTagLength: AUTH_TAG_BYTES,
	});
	cipher.setAAD(AAD);

	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return [
		ENVELOPE_VERSION,
		iv.toString("base64url"),
		authTag.toString("base64url"),
		ciphertext.toString("base64url"),
	].join(".");
}

/**
 * Decrypt a stored token. Throws {@link TokenCryptoError} for a missing key, a
 * malformed envelope, or a ciphertext that was tampered with or encrypted under
 * a different key. The message never contains any part of the secret.
 */
export function decryptToken(envelope: string): string {
	const key = encryptionKey();
	if (!key) {
		throw new TokenCryptoError(
			"missing_key",
			"Google token encryption is not configured.",
		);
	}

	const parts = envelope.split(".");
	if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
		throw new TokenCryptoError(
			"malformed_ciphertext",
			"Stored Google token is not in the expected format.",
		);
	}

	const [, ivPart, tagPart, ciphertextPart] = parts;
	let iv: Buffer;
	let authTag: Buffer;
	let ciphertext: Buffer;
	try {
		iv = Buffer.from(ivPart, "base64url");
		authTag = Buffer.from(tagPart, "base64url");
		ciphertext = Buffer.from(ciphertextPart, "base64url");
	} catch {
		throw new TokenCryptoError(
			"malformed_ciphertext",
			"Stored Google token is not in the expected format.",
		);
	}

	if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
		throw new TokenCryptoError(
			"malformed_ciphertext",
			"Stored Google token is not in the expected format.",
		);
	}

	try {
		const decipher = createDecipheriv(ALGORITHM, key, iv, {
			authTagLength: AUTH_TAG_BYTES,
		});
		decipher.setAAD(AAD);
		decipher.setAuthTag(authTag);
		const plaintext = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]);
		return plaintext.toString("utf8");
	} catch (cause) {
		throw new TokenCryptoError(
			"decrypt_failed",
			"Stored Google token could not be decrypted. Reconnect the calendar.",
			{ cause },
		);
	}
}

/**
 * Constant-time comparison for short secrets (e.g. OAuth state values). Length
 * differences are reported without leaking the compared bytes.
 */
export function secureEquals(a: string, b: string): boolean {
	const left = Buffer.from(a, "utf8");
	const right = Buffer.from(b, "utf8");
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}
