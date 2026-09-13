// src/lib/encryption.ts
//
// AES-256-GCM symmetric encryption for secrets we put in KV at rest.
//
// Why we need it: photo-platform OAuth tokens grant read access to a
// photographer's entire SmugMug or Dropbox. If our KV ever leaked, the
// raw tokens would be a goldmine for an attacker. Wrapping them with a
// master key kept in Cloudflare's secret store turns a KV leak into a
// non-event — without the master key the ciphertext is junk.
//
// Algorithm: AES-256-GCM via Web Crypto. GCM gives us authenticated
// encryption (integrity check is free) and is hardware-accelerated on
// every modern platform Cloudflare runs on.
//
// Format of a stored ciphertext blob (base64url, no padding):
//
//   `v1.${base64url(iv12)}.${base64url(ciphertext+authTag)}`
//
//   v1            — format version, lets us rotate algorithms later
//   iv12          — 12 random bytes (96-bit IV, NIST-recommended for GCM)
//   ciphertext+tag— AES-GCM output (Web Crypto appends the 16-byte tag)
//
// Master key:
//   - Env var: TOKEN_ENCRYPTION_KEY
//   - Format:  base64-encoded 32 random bytes (256 bits)
//   - Generate once with: `openssl rand -base64 32`
//   - Never rotate without re-encrypting every stored ciphertext

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Decode a base64 string (standard alphabet) to bytes. */
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Base64url encode bytes (URL-safe, no padding). */
function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a base64url string back to bytes. */
function b64urlToBytes(s: string): Uint8Array {
  // Restore standard base64 alphabet + padding
  let std = s.replace(/-/g, '+').replace(/_/g, '/');
  while (std.length % 4) std += '=';
  return b64ToBytes(std);
}

async function importMasterKey(rawBase64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(rawBase64.trim());
  if (raw.byteLength !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (base64-encoded). Got ${raw.byteLength}.`,
    );
  }
  // Cast through ArrayBuffer — Uint8Array<ArrayBufferLike> from atob isn't
  // narrow enough for Web Crypto's BufferSource on TS strict.
  return crypto.subtle.importKey(
    'raw',
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a UTF-8 string with the master key. Returns a base64url-encoded
 * blob that's safe to put in JSON/KV. Throws if the master key isn't a
 * valid 32-byte base64 string.
 */
export async function encryptString(plaintext: string, masterKeyB64: string): Promise<string> {
  const key = await importMasterKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );
  return `v1.${bytesToB64url(iv)}.${bytesToB64url(new Uint8Array(cipherBuf))}`;
}

/**
 * Decrypt a blob produced by `encryptString`. Returns the original
 * UTF-8 string. Throws if:
 *   - The blob isn't v1 format
 *   - The IV or ciphertext is malformed
 *   - The master key is wrong, or the ciphertext was tampered with
 *     (GCM auth tag check)
 *
 * Callers should catch and treat any failure as "data unrecoverable;
 * ask user to reconnect."
 */
export async function decryptString(blob: string, masterKeyB64: string): Promise<string> {
  const parts = blob.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Unsupported ciphertext format');
  }
  const iv = b64urlToBytes(parts[1]);
  const cipher = b64urlToBytes(parts[2]);
  const key = await importMasterKey(masterKeyB64);
  const cipherBuf = cipher.buffer.slice(cipher.byteOffset, cipher.byteOffset + cipher.byteLength) as ArrayBuffer;
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf },
    key,
    cipherBuf,
  );
  return dec.decode(plainBuf);
}

/**
 * Best-effort decrypt that returns null instead of throwing on failure.
 * Useful for batch operations (e.g. "list all connected accounts, decrypt
 * each one — skip the broken ones").
 */
export async function tryDecryptString(
  blob: string,
  masterKeyB64: string,
): Promise<string | null> {
  try {
    return await decryptString(blob, masterKeyB64);
  } catch {
    return null;
  }
}

/**
 * Generate a fresh 32-byte master key, base64-encoded. Use this once
 * during initial setup and paste the result into Cloudflare's secret
 * store as TOKEN_ENCRYPTION_KEY. Don't commit the value anywhere.
 *
 * (Provided as a function for completeness; in practice you'll run
 * `openssl rand -base64 32` once and forget about it.)
 */
export function generateMasterKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
