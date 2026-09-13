/**
 * POST /api/connect/{platform}/start
 *
 * Photographer-initiated OAuth. Requires a logged-in pro session.
 * Returns { authorizeUrl } — client redirects the photographer to it.
 *
 * Side effects:
 *   - Mints a random CSRF state token and stores it in KV (10-min TTL)
 *     keyed by `oauth_state:{state}`. Value contains the photographerId
 *     and any flow-state the adapter needs to remember (e.g. SmugMug
 *     request-token secret).
 *   - The callback route reads + deletes this entry to prevent replay.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import { readProSession } from '@/lib/photographer-auth';
import { getAdapter, type PlatformEnv } from '@/lib/photo-platforms';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env extends PlatformEnv {
  DESIGN_DRAFTS?: KVNamespace;
  ADMIN_PASSWORD?: string;
  SITE_URL?: string;
}

interface OAuthStateRecord {
  photographerId: string;
  platform: string;
  flowState: Record<string, string>;
  createdAt: string;
}

const OAUTH_STATE_TTL = 10 * 60; // 10 minutes

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
  const adapter = getAdapter(platform, env);
  if (!adapter) return err(400, `platform '${platform}' is not configured`);

  // CSRF state — passed through the redirect, validated on callback.
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const csrfState = Array.from(stateBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const siteUrl = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
  const redirectUri = `${siteUrl}/api/connect/${platform}/callback`;

  let authorizeUrl: string;
  let flowState: Record<string, string>;
  try {
    const result = await adapter.oauthStart({ redirectUri, csrfState });
    authorizeUrl = result.authorizeUrl;
    flowState = result.flowState;
  } catch (e) {
    return err(502, `Failed to start OAuth: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Persist the state so the callback can verify + recover flow state.
  const record: OAuthStateRecord = {
    photographerId,
    platform,
    flowState,
    createdAt: new Date().toISOString(),
  };
  await env.DESIGN_DRAFTS.put(`oauth_state:${csrfState}`, JSON.stringify(record), {
    expirationTtl: OAUTH_STATE_TTL,
  });

  return new Response(JSON.stringify({ authorizeUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
