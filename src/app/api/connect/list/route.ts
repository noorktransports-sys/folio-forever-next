/**
 * GET /api/connect/list
 *
 * Returns the photographer's connected accounts plus which platforms
 * are even available (configured at the server side). Drives the
 * "Connected Accounts" section of the photographer dashboard.
 *
 * Response: {
 *   ok: true,
 *   platforms: [{ id, displayName, configured }, ...],
 *   connected: [{ platform, username, displayName, status, connectedAt, galleryCount? }, ...],
 * }
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { readProSession } from '@/lib/photographer-auth';
import { listAccountsForPhotographer } from '@/lib/connected-accounts';
import { listSupportedPlatforms, type PlatformEnv } from '@/lib/photo-platforms';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env extends PlatformEnv {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
}

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(request: Request) {
  const { env } = getRequestContext() as { env: Env };
  if (!env.DESIGN_DRAFTS) return err(503, 'storage unavailable');

  const photographerId = await readProSession(request, env.ADMIN_PASSWORD);
  if (!photographerId) return err(401, 'photographer not signed in');

  const platforms = listSupportedPlatforms(env);
  const connected = await listAccountsForPhotographer(env.DESIGN_DRAFTS, photographerId);

  return new Response(
    JSON.stringify({ ok: true, platforms, connected }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
