/**
 * POST /api/connect/{platform}/disconnect
 *
 * Photographer-initiated disconnect. Calls the platform's revoke
 * endpoint (best-effort), then deletes the local record.
 *
 * In-flight pull jobs aren't aborted — they finish with their cached
 * token. New project creation against this platform is blocked because
 * the connected-account record is gone.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { readProSession } from '@/lib/photographer-auth';
import {
  appendSyncLog,
  decryptAccountToken,
  deleteConnectedAccount,
  readConnectedAccount,
} from '@/lib/connected-accounts';
import { getAdapter, type PlatformEnv } from '@/lib/photo-platforms';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

interface Env extends PlatformEnv {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
  TOKEN_ENCRYPTION_KEY?: string;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');

  const photographerId = await readProSession(request, env.ADMIN_PASSWORD);
  if (!photographerId) return err(401, 'photographer not signed in');

  const { platform } = await params;
  if (platform !== 'dropbox' && platform !== 'smugmug') return err(400, 'unknown platform');

  const record = await readConnectedAccount(env.DESIGN_DRAFTS, photographerId, platform);
  if (!record) {
    // Nothing to do — return success so the UI is idempotent.
    return new Response(JSON.stringify({ ok: true, message: 'already disconnected' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Best-effort revoke on platform side
  const started = Date.now();
  let revokeError: string | null = null;
  try {
    const adapter = getAdapter(platform, env);
    if (adapter && env.TOKEN_ENCRYPTION_KEY) {
      const token = await decryptAccountToken(record, env.TOKEN_ENCRYPTION_KEY);
      if (token) await adapter.revokeToken(token);
    }
  } catch (e) {
    revokeError = e instanceof Error ? e.message : String(e);
  }

  await deleteConnectedAccount(env.DESIGN_DRAFTS, photographerId, platform);

  await appendSyncLog(env.DESIGN_DRAFTS, {
    photographerId,
    platform,
    operation: 'disconnect',
    status: revokeError ? 'error' : 'success',
    durationMs: Date.now() - started,
    errorMessage: revokeError ?? undefined,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      revokeError, // null if successful — UI can show a "we couldn't fully revoke" note
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
