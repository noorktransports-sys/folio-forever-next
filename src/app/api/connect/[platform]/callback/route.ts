/**
 * GET /api/connect/{platform}/callback
 *
 * Final step of the OAuth handshake. Validates the CSRF state, exchanges
 * the platform's callback params for a long-lived token, persists the
 * connected-account record (token encrypted), and redirects the
 * photographer back to the dashboard.
 *
 * Failure modes:
 *   - Missing/invalid state → 400 + redirect to /pro?connect=error
 *   - User denied authorization → redirect to /pro?connect=denied
 *   - Platform rejected the code/verifier → redirect to /pro?connect=error
 *
 * On success → redirect to /pro?connect=success&platform={platform}
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import {
  appendSyncLog,
  saveConnectedAccount,
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
  SITE_URL?: string;
  TOKEN_ENCRYPTION_KEY?: string;
}

interface OAuthStateRecord {
  photographerId: string;
  platform: string;
  flowState: Record<string, string>;
  createdAt: string;
}

function redirectBack(siteUrl: string, status: 'success' | 'denied' | 'error', platform: string, detail?: string): Response {
  const url = new URL(`${siteUrl}/pro`);
  url.searchParams.set('connect', status);
  url.searchParams.set('platform', platform);
  if (detail) url.searchParams.set('detail', detail.slice(0, 120));
  return Response.redirect(url.toString(), 302);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { env } = getRequestContext() as { env: Env };
  const { platform } = await params;
  const siteUrl = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');

  // Collect callback query params
  const u = new URL(request.url);
  const callbackParams: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (callbackParams[k] = v));

  // User denial path (Dropbox sets error=access_denied, SmugMug omits oauth_verifier)
  if (callbackParams['error'] === 'access_denied' || callbackParams['denied']) {
    return redirectBack(siteUrl, 'denied', platform);
  }

  if (!env.DESIGN_DRAFTS) return redirectBack(siteUrl, 'error', platform, 'storage unavailable');
  if (!env.TOKEN_ENCRYPTION_KEY) return redirectBack(siteUrl, 'error', platform, 'TOKEN_ENCRYPTION_KEY not set');

  // Validate state. Both adapters pass our csrf state through; for SmugMug
  // we also recover the request-token secret from the persisted record.
  const csrfState = callbackParams['state'];
  if (!csrfState) return redirectBack(siteUrl, 'error', platform, 'missing state');
  const stateRaw = await env.DESIGN_DRAFTS.get(`oauth_state:${csrfState}`);
  if (!stateRaw) return redirectBack(siteUrl, 'error', platform, 'state expired or unknown');

  let stateRecord: OAuthStateRecord;
  try {
    stateRecord = JSON.parse(stateRaw) as OAuthStateRecord;
  } catch {
    return redirectBack(siteUrl, 'error', platform, 'state corrupt');
  }
  if (stateRecord.platform !== platform) {
    return redirectBack(siteUrl, 'error', platform, 'state platform mismatch');
  }

  // One-time use — delete now so a leaked callback can't be replayed.
  if (env.DESIGN_DRAFTS.delete) {
    await env.DESIGN_DRAFTS.delete(`oauth_state:${csrfState}`);
  } else {
    await env.DESIGN_DRAFTS.put(`oauth_state:${csrfState}`, '', { expirationTtl: 1 });
  }

  // Exchange the callback for a token via the adapter
  const adapter = getAdapter(platform, env);
  if (!adapter) return redirectBack(siteUrl, 'error', platform, 'platform not configured');

  const redirectUri = `${siteUrl}/api/connect/${platform}/callback`;
  const started = Date.now();
  try {
    const { token, account } = await adapter.oauthComplete({
      callbackParams,
      flowState: stateRecord.flowState,
      redirectUri,
    });

    // Persist the connected account (token encrypted inside saveConnectedAccount).
    await saveConnectedAccount(env.DESIGN_DRAFTS, env.TOKEN_ENCRYPTION_KEY, {
      photographerId: stateRecord.photographerId,
      platform: platform as 'dropbox' | 'smugmug',
      platformUserId: account.platformUserId,
      username: account.username,
      displayName: account.displayName,
      token,
    });

    await appendSyncLog(env.DESIGN_DRAFTS, {
      photographerId: stateRecord.photographerId,
      platform: platform as 'dropbox' | 'smugmug',
      operation: 'oauth_complete',
      status: 'success',
      durationMs: Date.now() - started,
    });

    return redirectBack(siteUrl, 'success', platform);
  } catch (e) {
    await appendSyncLog(env.DESIGN_DRAFTS, {
      photographerId: stateRecord.photographerId,
      platform: platform as 'dropbox' | 'smugmug',
      operation: 'oauth_complete',
      status: 'error',
      durationMs: Date.now() - started,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return redirectBack(siteUrl, 'error', platform, e instanceof Error ? e.message : 'oauth failed');
  }
}
