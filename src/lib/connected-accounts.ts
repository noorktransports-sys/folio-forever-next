// src/lib/connected-accounts.ts
//
// KV CRUD for photographer ↔ photo-platform connections. One record per
// (photographerId, platform) — for v1 we only allow one of each platform
// per photographer.
//
// On-disk shape (KV value, JSON):
//
//   {
//     photographerId: string,    // 10-hex
//     platform: 'dropbox' | 'smugmug',
//     platformUserId: string,    // stable id on the platform side
//     username: string,          // display string ("@joephoto")
//     displayName?: string,
//     status: 'active' | 'revoked' | 'error',
//     tokenCiphertext: string,   // encrypted PlatformToken JSON
//     connectedAt: string,       // ISO
//     lastSyncAt?: string,       // ISO
//     errorMessage?: string,     // when status='error'
//   }
//
// Keys:
//   `connected_account:{photographerId}:{platform}` — the record itself
//   `_connected_account_index_v1`                   — array of {photographerId, platform} for admin listing
//
// Tokens never appear in plaintext at rest — they're encrypted with the
// TOKEN_ENCRYPTION_KEY env var via src/lib/encryption.ts. If the master
// key changes or is unset, decryption fails and the connection is
// effectively dead until re-auth.

import { decryptString, encryptString } from './encryption';
import type { PlatformToken } from './photo-platforms/adapter';

const ACCOUNT_TTL_SECONDS = 5 * 365 * 24 * 60 * 60; // 5 years — effectively "until revoked"
const INDEX_KEY = '_connected_account_index_v1';

export interface ConnectedAccountRecord {
  photographerId: string;
  platform: 'dropbox' | 'smugmug';
  platformUserId: string;
  username: string;
  displayName?: string;
  status: 'active' | 'revoked' | 'error';
  /** AES-GCM-encrypted JSON of a PlatformToken. */
  tokenCiphertext: string;
  connectedAt: string;
  lastSyncAt?: string;
  errorMessage?: string;
  /** Cached gallery count for the dashboard so we don't fetch on every page load. */
  galleryCount?: number;
  galleryCountAt?: string;
}

export interface ConnectedAccountSummary {
  photographerId: string;
  platform: 'dropbox' | 'smugmug';
  platformUserId: string;
  username: string;
  displayName?: string;
  status: 'active' | 'revoked' | 'error';
  connectedAt: string;
  lastSyncAt?: string;
  errorMessage?: string;
  galleryCount?: number;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

interface IndexEntry {
  photographerId: string;
  platform: 'dropbox' | 'smugmug';
}

function recordKey(photographerId: string, platform: string): string {
  return `connected_account:${photographerId}:${platform}`;
}

export async function saveConnectedAccount(
  kv: KVNamespace,
  masterKey: string,
  input: {
    photographerId: string;
    platform: 'dropbox' | 'smugmug';
    platformUserId: string;
    username: string;
    displayName?: string;
    token: PlatformToken;
    galleryCount?: number;
  },
): Promise<void> {
  const tokenCiphertext = await encryptString(JSON.stringify(input.token), masterKey);
  const now = new Date().toISOString();
  const record: ConnectedAccountRecord = {
    photographerId: input.photographerId,
    platform: input.platform,
    platformUserId: input.platformUserId,
    username: input.username,
    displayName: input.displayName,
    status: 'active',
    tokenCiphertext,
    connectedAt: now,
    galleryCount: input.galleryCount,
    galleryCountAt: input.galleryCount !== undefined ? now : undefined,
  };
  await kv.put(
    recordKey(input.photographerId, input.platform),
    JSON.stringify(record),
    { expirationTtl: ACCOUNT_TTL_SECONDS },
  );
  await appendIndex(kv, { photographerId: input.photographerId, platform: input.platform });
}

export async function readConnectedAccount(
  kv: KVNamespace,
  photographerId: string,
  platform: 'dropbox' | 'smugmug',
): Promise<ConnectedAccountRecord | null> {
  const raw = await kv.get(recordKey(photographerId, platform));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConnectedAccountRecord;
  } catch {
    return null;
  }
}

/**
 * Decrypt the token for a connected account. Returns null if decryption
 * fails — caller should mark the connection as 'error' and surface
 * "please reconnect" to the photographer.
 */
export async function decryptAccountToken(
  record: ConnectedAccountRecord,
  masterKey: string,
): Promise<PlatformToken | null> {
  try {
    const json = await decryptString(record.tokenCiphertext, masterKey);
    const parsed = JSON.parse(json) as PlatformToken;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist an updated token (e.g. after refresh). Re-encrypts.
 */
export async function updateAccountToken(
  kv: KVNamespace,
  masterKey: string,
  photographerId: string,
  platform: 'dropbox' | 'smugmug',
  token: PlatformToken,
): Promise<void> {
  const record = await readConnectedAccount(kv, photographerId, platform);
  if (!record) return;
  const tokenCiphertext = await encryptString(JSON.stringify(token), masterKey);
  await kv.put(
    recordKey(photographerId, platform),
    JSON.stringify({ ...record, tokenCiphertext, lastSyncAt: new Date().toISOString() }),
    { expirationTtl: ACCOUNT_TTL_SECONDS },
  );
}

export async function markAccountStatus(
  kv: KVNamespace,
  photographerId: string,
  platform: 'dropbox' | 'smugmug',
  status: 'active' | 'revoked' | 'error',
  errorMessage?: string,
): Promise<void> {
  const record = await readConnectedAccount(kv, photographerId, platform);
  if (!record) return;
  await kv.put(
    recordKey(photographerId, platform),
    JSON.stringify({ ...record, status, errorMessage, lastSyncAt: new Date().toISOString() }),
    { expirationTtl: ACCOUNT_TTL_SECONDS },
  );
}

export async function setGalleryCount(
  kv: KVNamespace,
  photographerId: string,
  platform: 'dropbox' | 'smugmug',
  count: number,
): Promise<void> {
  const record = await readConnectedAccount(kv, photographerId, platform);
  if (!record) return;
  const now = new Date().toISOString();
  await kv.put(
    recordKey(photographerId, platform),
    JSON.stringify({ ...record, galleryCount: count, galleryCountAt: now, lastSyncAt: now }),
    { expirationTtl: ACCOUNT_TTL_SECONDS },
  );
}

export async function deleteConnectedAccount(
  kv: KVNamespace,
  photographerId: string,
  platform: 'dropbox' | 'smugmug',
): Promise<void> {
  if (kv.delete) {
    await kv.delete(recordKey(photographerId, platform));
  } else {
    // Some KV bindings only expose put/get; fall back to an empty marker
    // with a short TTL so the record auto-expires.
    await kv.put(recordKey(photographerId, platform), '', { expirationTtl: 60 });
  }
  await removeFromIndex(kv, photographerId, platform);
}

export async function listAccountsForPhotographer(
  kv: KVNamespace,
  photographerId: string,
): Promise<ConnectedAccountSummary[]> {
  const platforms: Array<'dropbox' | 'smugmug'> = ['dropbox', 'smugmug'];
  const out: ConnectedAccountSummary[] = [];
  for (const p of platforms) {
    const r = await readConnectedAccount(kv, photographerId, p);
    if (!r) continue;
    out.push({
      photographerId: r.photographerId,
      platform: r.platform,
      platformUserId: r.platformUserId,
      username: r.username,
      displayName: r.displayName,
      status: r.status,
      connectedAt: r.connectedAt,
      lastSyncAt: r.lastSyncAt,
      errorMessage: r.errorMessage,
      galleryCount: r.galleryCount,
    });
  }
  return out;
}

/* ─── Index helpers (admin can scan all connections) ───────────────── */

async function appendIndex(kv: KVNamespace, entry: IndexEntry): Promise<void> {
  const raw = await kv.get(INDEX_KEY);
  const list: IndexEntry[] = raw ? (JSON.parse(raw) as IndexEntry[]) : [];
  if (!list.find((e) => e.photographerId === entry.photographerId && e.platform === entry.platform)) {
    list.push(entry);
    await kv.put(INDEX_KEY, JSON.stringify(list));
  }
}

async function removeFromIndex(kv: KVNamespace, photographerId: string, platform: 'dropbox' | 'smugmug'): Promise<void> {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return;
  const list = JSON.parse(raw) as IndexEntry[];
  const next = list.filter((e) => !(e.photographerId === photographerId && e.platform === platform));
  if (next.length !== list.length) {
    await kv.put(INDEX_KEY, JSON.stringify(next));
  }
}

/* ─── Audit log ────────────────────────────────────────────────────── */

export interface SyncLogEntry {
  photographerId: string;
  platform: 'dropbox' | 'smugmug';
  operation: string;
  status: 'success' | 'rate_limited' | 'auth_error' | 'not_found' | 'error';
  durationMs?: number;
  errorMessage?: string;
  at: string;
}

const SYNC_LOG_TTL = 30 * 24 * 60 * 60; // 30 days

export async function appendSyncLog(
  kv: KVNamespace,
  entry: Omit<SyncLogEntry, 'at'>,
): Promise<void> {
  const at = new Date().toISOString();
  // Each entry is its own KV key — easier than maintaining a giant array.
  // Key shape lets us list by prefix later: `platform_sync_log:{photographerId}:{ts}_{nonce}`
  const nonceBytes = new Uint8Array(4);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const key = `platform_sync_log:${entry.photographerId}:${at}_${nonce}`;
  await kv.put(key, JSON.stringify({ ...entry, at }), { expirationTtl: SYNC_LOG_TTL });
}
