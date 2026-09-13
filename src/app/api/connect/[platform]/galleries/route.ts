/**
 * GET /api/connect/{platform}/galleries?cursor=...&limit=...
 *
 * Lists the photographer's galleries from the chosen platform. Used by
 * the project-creation flow's gallery picker.
 *
 * Auto-refreshes expired OAuth2 tokens (Dropbox). If refresh fails,
 * marks the connection as 'revoked' and returns 401 so the UI can
 * prompt to reconnect.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { readProSession } from '@/lib/photographer-auth';
import {
  appendSyncLog,
  decryptAccountToken,
  markAccountStatus,
  readConnectedAccount,
  setGalleryCount,
  updateAccountToken,
} from '@/lib/connected-accounts';
import { getAdapter, PlatformError, type PlatformEnv } from '@/lib/photo-platforms';

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');
  if (!env.TOKEN_ENCRYPTION_KEY) return err(500, 'TOKEN_ENCRYPTION_KEY not configured');

  const photographerId = await readProSession(request, env.ADMIN_PASSWORD);
  if (!photographerId) return err(401, 'photographer not signed in');

  const { platform } = await params;
  if (platform !== 'dropbox' && platform !== 'smugmug') return err(400, 'unknown platform');

  const adapter = getAdapter(platform, env);
  if (!adapter) return err(400, 'platform not configured');

  const record = await readConnectedAccount(env.DESIGN_DRAFTS, photographerId, platform);
  if (!record) return err(404, 'no connected account for this platform');
  if (record.status !== 'active') return err(409, `connection is ${record.status} — reconnect first`);

  let token = await decryptAccountToken(record, env.TOKEN_ENCRYPTION_KEY);
  if (!token) {
    await markAccountStatus(env.DESIGN_DRAFTS, photographerId, platform, 'error', 'token decrypt failed');
    return err(500, 'connected-account token unreadable — reconnect');
  }

  // OAuth2 lazy refresh — if token is within 5 min of expiry, refresh now.
  if (token.kind === 'oauth2' && token.expiresAt && token.expiresAt - Date.now() < 5 * 60 * 1000) {
    try {
      token = await adapter.refreshToken(token);
      await updateAccountToken(env.DESIGN_DRAFTS, env.TOKEN_ENCRYPTION_KEY, photographerId, platform, token);
    } catch (e) {
      if (e instanceof PlatformError && e.code === 'auth_revoked') {
        await markAccountStatus(env.DESIGN_DRAFTS, photographerId, platform, 'revoked', 'refresh failed');
        return err(401, 'token expired and refresh failed — reconnect');
      }
      return err(502, `token refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = parseInt(url.searchParams.get('limit') ?? '200', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 200;

  const started = Date.now();
  try {
    const { galleries, nextCursor } = await adapter.listGalleries(token, { cursor, limit });

    // First page only — refresh the cached gallery count on the account record.
    if (!cursor) {
      await setGalleryCount(env.DESIGN_DRAFTS, photographerId, platform, galleries.length);
    }

    await appendSyncLog(env.DESIGN_DRAFTS, {
      photographerId,
      platform,
      operation: 'list_galleries',
      status: 'success',
      durationMs: Date.now() - started,
    });

    return new Response(
      JSON.stringify({ ok: true, galleries, nextCursor }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const code = e instanceof PlatformError ? e.code : 'unknown';
    if (code === 'auth_revoked' || code === 'auth_expired') {
      await markAccountStatus(env.DESIGN_DRAFTS, photographerId, platform, 'revoked', 'auth lost');
    }
    await appendSyncLog(env.DESIGN_DRAFTS, {
      photographerId,
      platform,
      operation: 'list_galleries',
      status: code === 'rate_limited' ? 'rate_limited' : code === 'auth_revoked' || code === 'auth_expired' ? 'auth_error' : code === 'not_found' ? 'not_found' : 'error',
      durationMs: Date.now() - started,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    if (code === 'rate_limited') return err(429, 'platform rate-limited — try again in a minute');
    if (code === 'auth_revoked' || code === 'auth_expired') return err(401, 'connection lost — reconnect');
    if (code === 'platform_down') return err(502, 'platform temporarily unavailable');
    return err(502, `gallery list failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}
