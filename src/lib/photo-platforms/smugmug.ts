// src/lib/photo-platforms/smugmug.ts
//
// SmugMug adapter — OAuth 1.0a (the older spec, hand-rolled signing).
//
// API docs: https://api.smugmug.com/api/v2/doc
//
// OAuth 1.0a flow (3 steps):
//   1. Get a request token from /services/oauth/1.0a/getRequestToken
//   2. Redirect the user to /services/oauth/1.0a/authorize?oauth_token=...
//   3. After user approves, callback URL gets oauth_token + oauth_verifier;
//      exchange them at /services/oauth/1.0a/getAccessToken for the
//      permanent access token + secret.
//
// Signing:
//   Every signed request must include OAuth params (oauth_consumer_key,
//   oauth_signature_method=HMAC-SHA1, oauth_timestamp, oauth_nonce, etc.)
//   plus an oauth_signature computed via HMAC-SHA1 over a normalized
//   string representation of the request. The key is
//   `<consumerSecret>&<tokenSecret>` (empty tokenSecret for unsigned
//   request-token call).
//
// Caveats discovered:
//   - SmugMug tokens are permanent until the user revokes them. No refresh.
//   - "Original downloads" may be disabled at the album OR account level;
//     a download attempt then returns 403 — adapter maps to
//     `downloads_disabled`.
//   - Albums vs Folders: SmugMug has nested folders. For v1 we only list
//     top-level Albums (which contain Images) — folder navigation is v2.
//   - The image list endpoint returns Image objects; the original URL is
//     a separate `ImageDownload` endpoint that returns a 302 to the file.

import {
  type DownloadedPhoto,
  type ListPhotosOptions,
  type ListPhotosResult,
  type OAuthCompleteInput,
  type OAuthCompleteResult,
  type OAuthStartResult,
  PlatformError,
  type PlatformAccountInfo,
  type PlatformGallery,
  type PlatformPhoto,
  type PlatformToken,
  type PhotoPlatformAdapter,
} from './adapter';

const API_BASE = 'https://api.smugmug.com';
const OAUTH_BASE = 'https://api.smugmug.com/services/oauth/1.0a';
const AUTHORIZE_URL = 'https://api.smugmug.com/services/oauth/1.0a/authorize';

const ACCEPTED_MIME: Record<string, PlatformPhoto['contentType']> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/heic': 'image/heic',
  'image/heif': 'image/heic',
  'image/png': 'image/png',
  'image/avif': 'image/avif',
};

export interface SmugMugAdapterConfig {
  consumerKey: string;
  consumerSecret: string;
}

/* ─── OAuth 1.0a signing ───────────────────────────────────────────── */

/** RFC 3986 percent-encoding — stricter than encodeURIComponent. */
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha1Base64(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

interface SignParams {
  method: 'GET' | 'POST';
  url: string; // without query string
  queryParams?: Record<string, string>;
  bodyParams?: Record<string, string>; // form-encoded only
  oauthParams: Record<string, string>;
  consumerSecret: string;
  tokenSecret?: string;
}

/**
 * Compute the oauth_signature value for a request. Returns the new map
 * of OAuth params (with `oauth_signature` filled in) — caller turns this
 * into an Authorization header.
 */
async function signRequest(p: SignParams): Promise<Record<string, string>> {
  // Build the "parameter string" — all parameters (oauth + query + body),
  // each percent-encoded, sorted by key (then value), joined with `&`.
  const all: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(p.oauthParams)) all.push([rfc3986(k), rfc3986(v)]);
  for (const [k, v] of Object.entries(p.queryParams ?? {})) all.push([rfc3986(k), rfc3986(v)]);
  for (const [k, v] of Object.entries(p.bodyParams ?? {})) all.push([rfc3986(k), rfc3986(v)]);
  all.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const paramString = all.map(([k, v]) => `${k}=${v}`).join('&');

  // The base string: METHOD & URL & paramString (each percent-encoded).
  const baseString = `${p.method}&${rfc3986(p.url)}&${rfc3986(paramString)}`;
  const signingKey = `${rfc3986(p.consumerSecret)}&${rfc3986(p.tokenSecret ?? '')}`;
  const signature = await hmacSha1Base64(baseString, signingKey);

  return { ...p.oauthParams, oauth_signature: signature };
}

function buildAuthHeader(oauthParams: Record<string, string>): string {
  // OAuth header format: OAuth k="v", k2="v2", ... — values percent-encoded
  const parts = Object.entries(oauthParams)
    .filter(([k]) => k.startsWith('oauth_'))
    .map(([k, v]) => `${k}="${rfc3986(v)}"`)
    .join(', ');
  return `OAuth ${parts}`;
}

interface SignedFetchInput {
  method: 'GET' | 'POST';
  url: string;
  queryParams?: Record<string, string>;
  bodyParams?: Record<string, string>;
  consumerKey: string;
  consumerSecret: string;
  tokenKey?: string;
  tokenSecret?: string;
  extraOAuth?: Record<string, string>;
  headers?: Record<string, string>;
  accept?: string;
}

async function signedFetch(p: SignedFetchInput): Promise<Response> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: p.consumerKey,
    oauth_nonce: nonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...(p.tokenKey ? { oauth_token: p.tokenKey } : {}),
    ...(p.extraOAuth ?? {}),
  };
  const signed = await signRequest({
    method: p.method,
    url: p.url,
    queryParams: p.queryParams,
    bodyParams: p.bodyParams,
    oauthParams,
    consumerSecret: p.consumerSecret,
    tokenSecret: p.tokenSecret,
  });
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(signed),
    Accept: p.accept ?? 'application/json',
    ...(p.headers ?? {}),
  };

  let url = p.url;
  if (p.queryParams && Object.keys(p.queryParams).length) {
    const usp = new URLSearchParams(p.queryParams);
    url += (url.includes('?') ? '&' : '?') + usp.toString();
  }

  const init: RequestInit = { method: p.method, headers };
  if (p.bodyParams && p.method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(p.bodyParams).toString();
  }
  return fetch(url, init);
}

/* ─── Error translation ────────────────────────────────────────────── */

async function readSmugMugError(r: Response): Promise<PlatformError> {
  let detail: unknown = null;
  try {
    detail = await r.json();
  } catch {
    try {
      detail = await r.text();
    } catch {
      /* ignore */
    }
  }
  if (r.status === 401) {
    return new PlatformError('auth_revoked', 'SmugMug returned 401', { detail });
  }
  if (r.status === 403) {
    // Could be either insufficient scope (rare on SmugMug, since we
    // ask for Full access at OAuth time) OR downloads disabled.
    const text = JSON.stringify(detail ?? '').toLowerCase();
    if (text.includes('download') || text.includes('originaldownload')) {
      return new PlatformError('downloads_disabled', 'SmugMug downloads disabled', { detail });
    }
    return new PlatformError('insufficient_scope', 'SmugMug returned 403', { detail });
  }
  if (r.status === 404) {
    return new PlatformError('not_found', 'SmugMug returned 404', { detail });
  }
  if (r.status === 429) {
    const retry = parseInt(r.headers.get('retry-after') || '0', 10);
    return new PlatformError('rate_limited', 'SmugMug rate-limited', {
      retryAfterSeconds: retry || 60,
      detail,
    });
  }
  if (r.status >= 500) {
    return new PlatformError('platform_down', 'SmugMug 5xx', { detail });
  }
  return new PlatformError('unknown', `SmugMug HTTP ${r.status}`, { detail });
}

/* ─── Types for the bits of the SmugMug API response we read ───────── */

interface SmugMugUserNode {
  NickName: string;
  Name: string;
  Uri: string;
  WebUri: string;
  Plan?: string;
}

interface SmugMugAlbumNode {
  AlbumKey: string;
  Name: string;
  ImageCount?: number;
  LastUpdated?: string;
  WebUri?: string;
  Uris?: Record<string, { Uri: string }>;
  AllowDownloads?: boolean;
}

interface SmugMugImageNode {
  ImageKey: string;
  FileName: string;
  OriginalWidth: number;
  OriginalHeight: number;
  OriginalSize?: number;
  Format?: string;
  Date?: string;
  ThumbnailUrl?: string;
  Uris?: Record<string, { Uri: string }>;
  IsVideo?: boolean;
  ArchivedUri?: string;
}

/* ─── Adapter ──────────────────────────────────────────────────────── */

function ensureOAuth1Token(token: PlatformToken): asserts token is Extract<PlatformToken, { kind: 'oauth1' }> {
  if (token.kind !== 'oauth1') {
    throw new PlatformError('unknown', 'SmugMug requires an OAuth1 token, got ' + token.kind);
  }
}

export class SmugMugAdapter implements PhotoPlatformAdapter {
  readonly platformId = 'smugmug';
  readonly displayName = 'SmugMug';

  constructor(private cfg: SmugMugAdapterConfig) {}

  async oauthStart({ redirectUri, csrfState }: { redirectUri: string; csrfState: string }): Promise<OAuthStartResult> {
    // Step 1 — request token (signed with consumer creds + empty token secret)
    const r = await signedFetch({
      method: 'POST',
      url: `${OAUTH_BASE}/getRequestToken`,
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      extraOAuth: {
        oauth_callback: redirectUri,
      },
      accept: '*/*',
    });
    if (!r.ok) throw await readSmugMugError(r);
    const text = await r.text();
    const parsed = parseOAuthResponse(text);
    const oauth_token = parsed['oauth_token'];
    const oauth_token_secret = parsed['oauth_token_secret'];
    if (!oauth_token || !oauth_token_secret) {
      throw new PlatformError('unknown', 'SmugMug request-token response missing fields', { detail: text });
    }

    // Step 2 — build the authorize URL. Request "Full" + "Read" by default.
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('oauth_token', oauth_token);
    url.searchParams.set('Access', 'Full');
    url.searchParams.set('Permissions', 'Read');
    url.searchParams.set('state', csrfState);
    return {
      authorizeUrl: url.toString(),
      // We MUST persist the request-token secret across the redirect —
      // SmugMug requires us to sign step 3 with this same secret.
      flowState: {
        requestToken: oauth_token,
        requestTokenSecret: oauth_token_secret,
      },
    };
  }

  async oauthComplete({ callbackParams, flowState }: OAuthCompleteInput & { redirectUri: string }): Promise<OAuthCompleteResult> {
    const oauth_token = callbackParams['oauth_token'];
    const oauth_verifier = callbackParams['oauth_verifier'];
    if (!oauth_token || !oauth_verifier) {
      throw new PlatformError('unknown', 'SmugMug callback missing oauth_token or oauth_verifier');
    }
    const requestTokenSecret = flowState['requestTokenSecret'];
    if (!requestTokenSecret) {
      throw new PlatformError('unknown', 'Lost request token secret across redirect');
    }

    // Step 3 — exchange verifier for permanent access token
    const r = await signedFetch({
      method: 'POST',
      url: `${OAUTH_BASE}/getAccessToken`,
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenKey: oauth_token,
      tokenSecret: requestTokenSecret,
      extraOAuth: { oauth_verifier },
      accept: '*/*',
    });
    if (!r.ok) throw await readSmugMugError(r);
    const text = await r.text();
    const parsed = parseOAuthResponse(text);
    const accessToken = parsed['oauth_token'];
    const accessTokenSecret = parsed['oauth_token_secret'];
    if (!accessToken || !accessTokenSecret) {
      throw new PlatformError('unknown', 'SmugMug access-token response missing fields', { detail: text });
    }
    const token: PlatformToken = {
      kind: 'oauth1',
      platform: this.platformId,
      accessToken,
      accessTokenSecret,
    };
    const account = await this.getAccountInfo(token);
    return { token, account };
  }

  async refreshToken(token: PlatformToken): Promise<PlatformToken> {
    // SmugMug tokens are permanent — refresh is a no-op.
    return token;
  }

  async revokeToken(_token: PlatformToken): Promise<void> {
    // SmugMug has no programmatic revoke. The photographer must remove
    // the app from their SmugMug Account Settings → Permissions page.
    // We can email them a deep link to it as a follow-up; the adapter
    // itself is a no-op so the disconnect flow stays uniform.
    return;
  }

  async getAccountInfo(token: PlatformToken): Promise<PlatformAccountInfo> {
    ensureOAuth1Token(token);
    const r = await signedFetch({
      method: 'GET',
      url: `${API_BASE}/api/v2!authuser`,
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenKey: token.accessToken,
      tokenSecret: token.accessTokenSecret,
    });
    if (!r.ok) throw await readSmugMugError(r);
    const j = (await r.json()) as { Response?: { User?: SmugMugUserNode } };
    const u = j.Response?.User;
    if (!u) throw new PlatformError('unknown', 'SmugMug authuser response missing User');
    return {
      platformUserId: u.NickName,
      username: u.NickName,
      displayName: u.Name,
    };
  }

  async listGalleries(token: PlatformToken, _opts: { cursor?: string | null; limit?: number } = {}): Promise<{
    galleries: PlatformGallery[];
    nextCursor: string | null;
  }> {
    ensureOAuth1Token(token);
    // Step 1: get the user node so we can find their user-albums URI.
    const userResp = await signedFetch({
      method: 'GET',
      url: `${API_BASE}/api/v2!authuser`,
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenKey: token.accessToken,
      tokenSecret: token.accessTokenSecret,
    });
    if (!userResp.ok) throw await readSmugMugError(userResp);
    const userJson = (await userResp.json()) as {
      Response?: { User?: { NickName?: string } };
    };
    const nick = userJson.Response?.User?.NickName;
    if (!nick) throw new PlatformError('unknown', 'Missing NickName from SmugMug authuser');

    // Step 2: list all the user's albums. SmugMug paginates this with start/count.
    // For v1 we grab up to 500 and report them; pagination cursor passthrough is v2.
    const r = await signedFetch({
      method: 'GET',
      url: `${API_BASE}/api/v2/user/${encodeURIComponent(nick)}!albums`,
      queryParams: { start: '1', count: '500' },
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenKey: token.accessToken,
      tokenSecret: token.accessTokenSecret,
    });
    if (!r.ok) throw await readSmugMugError(r);
    const j = (await r.json()) as { Response?: { Album?: SmugMugAlbumNode[] } };
    const list = j.Response?.Album ?? [];
    const galleries: PlatformGallery[] = list.map((a) => ({
      id: a.AlbumKey,
      name: a.Name,
      photoCount: a.ImageCount,
      updatedAt: a.LastUpdated ? Date.parse(a.LastUpdated) : undefined,
    }));
    return { galleries, nextCursor: null };
  }

  async listPhotos(token: PlatformToken, galleryId: string, opts: ListPhotosOptions = {}): Promise<ListPhotosResult> {
    ensureOAuth1Token(token);
    const start = opts.cursor ? parseInt(opts.cursor, 10) : 1;
    const count = Math.min(opts.limit ?? 100, 500);
    const r = await signedFetch({
      method: 'GET',
      url: `${API_BASE}/api/v2/album/${encodeURIComponent(galleryId)}!images`,
      queryParams: {
        start: String(start),
        count: String(count),
      },
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenKey: token.accessToken,
      tokenSecret: token.accessTokenSecret,
    });
    if (!r.ok) throw await readSmugMugError(r);
    const j = (await r.json()) as {
      Response?: { AlbumImage?: SmugMugImageNode[]; Pages?: { Total?: number } };
    };
    const list = (j.Response?.AlbumImage ?? []).filter((img) => !img.IsVideo);
    const photos: PlatformPhoto[] = [];
    for (const img of list) {
      const format = (img.Format ?? '').toLowerCase();
      const mime = format === 'jpg' || format === 'jpeg'
        ? 'image/jpeg'
        : format === 'png'
        ? 'image/png'
        : format === 'heic'
        ? 'image/heic'
        : format === 'avif'
        ? 'image/avif'
        : null;
      if (!mime) continue; // skip raw / unsupported formats
      photos.push({
        id: img.ImageKey,
        filename: img.FileName,
        width: img.OriginalWidth,
        height: img.OriginalHeight,
        size: img.OriginalSize,
        thumbnailUrl: img.ThumbnailUrl ?? '',
        contentType: mime,
        capturedAt: img.Date,
      });
    }
    const total = j.Response?.Pages?.Total ?? (start - 1 + list.length);
    const nextStart = start + list.length;
    const nextCursor = nextStart > total ? null : String(nextStart);
    return { photos, nextCursor };
  }

  async downloadOriginal(token: PlatformToken, _galleryId: string, photoId: string): Promise<DownloadedPhoto> {
    ensureOAuth1Token(token);
    // Look up the image's archive (original) URI.
    const detailResp = await signedFetch({
      method: 'GET',
      url: `${API_BASE}/api/v2/image/${encodeURIComponent(photoId)}`,
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenKey: token.accessToken,
      tokenSecret: token.accessTokenSecret,
    });
    if (!detailResp.ok) throw await readSmugMugError(detailResp);
    const detailJson = (await detailResp.json()) as { Response?: { Image?: SmugMugImageNode } };
    const img = detailJson.Response?.Image;
    if (!img) throw new PlatformError('not_found', 'SmugMug image detail missing');
    if (!img.ArchivedUri) {
      throw new PlatformError('downloads_disabled', 'No ArchivedUri — original downloads may be disabled');
    }

    const archiveResp = await signedFetch({
      method: 'GET',
      url: img.ArchivedUri.startsWith('http') ? img.ArchivedUri : `${API_BASE}${img.ArchivedUri}`,
      consumerKey: this.cfg.consumerKey,
      consumerSecret: this.cfg.consumerSecret,
      tokenKey: token.accessToken,
      tokenSecret: token.accessTokenSecret,
      accept: '*/*',
    });
    if (!archiveResp.ok || !archiveResp.body) throw await readSmugMugError(archiveResp);

    const contentType = archiveResp.headers.get('content-type') ?? 'image/jpeg';
    if (!ACCEPTED_MIME[contentType.split(';')[0].trim().toLowerCase()]) {
      throw new PlatformError('unknown', `Unexpected content type from SmugMug: ${contentType}`);
    }
    const len = parseInt(archiveResp.headers.get('content-length') || '0', 10);
    return {
      body: archiveResp.body,
      contentType,
      contentLength: Number.isFinite(len) && len > 0 ? len : undefined,
      filename: img.FileName,
    };
  }
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

/** SmugMug's OAuth endpoints return application/x-www-form-urlencoded. */
function parseOAuthResponse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    out[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1));
  }
  return out;
}
