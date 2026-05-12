// src/lib/photo-platforms/dropbox.ts
//
// Dropbox adapter — OAuth 2.0 with PKCE-free server-side flow.
//
// API docs: https://www.dropbox.com/developers/documentation/http/documentation
//
// Notes that bit us during design:
//   - Modern Dropbox access tokens expire in 4 hours, so EVERY token-bound
//     call needs to be prepared to refresh on a 401.
//   - "Folders" are this adapter's "galleries". Dropbox paths are strings
//     starting with "/" — we use the path as the gallery ID directly so
//     callers don't need to keep two IDs around.
//   - Thumbnails: /2/files/get_thumbnail_v2 — returns binary. We can't
//     serve binary thumbnails directly from KV/R2 to a public-facing
//     client view, so the gallery view will need a separate proxy
//     endpoint that streams these through. (Out of scope for the adapter
//     itself.) For now `thumbnailUrl` is set to a path we own and
//     resolve at request time.
//   - File type filter: enforced both in listPhotos (skip non-images) and
//     download (refuse non-image content_type from the API).

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

const API_BASE = 'https://api.dropboxapi.com';
const CONTENT_BASE = 'https://content.dropboxapi.com';

const ACCEPTED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/heic',
  'image/heif',
  'image/png',
  'image/avif',
]);

const ACCEPTED_EXT = new Set([
  'jpg',
  'jpeg',
  'heic',
  'heif',
  'png',
  'avif',
]);

interface DropboxFolderEntry {
  '.tag': 'folder';
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
}

interface DropboxFileEntry {
  '.tag': 'file';
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
  client_modified: string;
  server_modified: string;
  size: number;
  media_info?: {
    metadata?: {
      '.tag'?: 'photo' | 'video';
      dimensions?: { width: number; height: number };
      time_taken?: string;
    };
  };
}

type DropboxEntry = DropboxFolderEntry | DropboxFileEntry;

interface DropboxListResponse {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
}

interface DropboxAccountResponse {
  account_id: string;
  name: { display_name: string; familiar_name: string };
  email: string;
}

export interface DropboxAdapterConfig {
  appKey: string;
  appSecret: string;
}

function mimeFromName(name: string): PlatformPhoto['contentType'] | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'png':
      return 'image/png';
    case 'avif':
      return 'image/avif';
    default:
      return null;
  }
}

function isAcceptedFile(entry: DropboxFileEntry): boolean {
  const dot = entry.name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = entry.name.slice(dot + 1).toLowerCase();
  return ACCEPTED_EXT.has(ext);
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function ensureOAuth2Token(token: PlatformToken): asserts token is Extract<PlatformToken, { kind: 'oauth2' }> {
  if (token.kind !== 'oauth2') {
    throw new PlatformError('unknown', 'Dropbox requires an OAuth2 token, got ' + token.kind);
  }
}

async function rpcCall(
  endpoint: string,
  accessToken: string,
  body: unknown,
): Promise<Response> {
  const r = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? null),
  });
  return r;
}

async function readDropboxError(r: Response): Promise<PlatformError> {
  let detail: unknown = null;
  try {
    detail = await r.json();
  } catch {
    /* ignore */
  }
  if (r.status === 401) {
    return new PlatformError('auth_expired', 'Dropbox returned 401', { detail });
  }
  if (r.status === 403) {
    return new PlatformError('insufficient_scope', 'Dropbox returned 403', { detail });
  }
  if (r.status === 404) {
    return new PlatformError('not_found', 'Dropbox returned 404', { detail });
  }
  if (r.status === 429) {
    const retryAfter = parseInt(r.headers.get('retry-after') || '0', 10);
    return new PlatformError('rate_limited', 'Dropbox rate-limited', {
      retryAfterSeconds: retryAfter || 60,
      detail,
    });
  }
  if (r.status >= 500) {
    return new PlatformError('platform_down', 'Dropbox 5xx', { detail });
  }
  return new PlatformError('unknown', `Dropbox HTTP ${r.status}`, { detail });
}

/* ─── Adapter ──────────────────────────────────────────────────────── */

export class DropboxAdapter implements PhotoPlatformAdapter {
  readonly platformId = 'dropbox';
  readonly displayName = 'Dropbox';

  constructor(private cfg: DropboxAdapterConfig) {}

  async oauthStart({ redirectUri, csrfState }: { redirectUri: string; csrfState: string }): Promise<OAuthStartResult> {
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.searchParams.set('client_id', this.cfg.appKey);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', csrfState);
    // Critical — without offline access we'd only get a 4-hour token and
    // never see a refresh token. Photographers don't want to reconnect
    // every 4 hours.
    url.searchParams.set('token_access_type', 'offline');
    return { authorizeUrl: url.toString(), flowState: {} };
  }

  async oauthComplete({ callbackParams, redirectUri }: OAuthCompleteInput & { redirectUri: string }): Promise<OAuthCompleteResult> {
    const code = callbackParams['code'];
    if (!code) throw new PlatformError('unknown', 'Missing code in callback');

    const form = new URLSearchParams();
    form.set('code', code);
    form.set('grant_type', 'authorization_code');
    form.set('redirect_uri', redirectUri);
    form.set('client_id', this.cfg.appKey);
    form.set('client_secret', this.cfg.appSecret);

    const r = await fetch(`${API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!r.ok) throw await readDropboxError(r);
    const j = (await r.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      account_id?: string;
    };

    const token: PlatformToken = {
      kind: 'oauth2',
      platform: this.platformId,
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    };
    const account = await this.getAccountInfo(token);
    return { token, account };
  }

  async refreshToken(token: PlatformToken): Promise<PlatformToken> {
    ensureOAuth2Token(token);
    if (!token.refreshToken) {
      throw new PlatformError('auth_revoked', 'No refresh token; user must reconnect');
    }
    const form = new URLSearchParams();
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', token.refreshToken);
    form.set('client_id', this.cfg.appKey);
    form.set('client_secret', this.cfg.appSecret);

    const r = await fetch(`${API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!r.ok) {
      const e = await readDropboxError(r);
      if (e.code === 'auth_expired') {
        // The refresh token itself was revoked
        throw new PlatformError('auth_revoked', 'Dropbox refused refresh — user must reconnect');
      }
      throw e;
    }
    const j = (await r.json()) as {
      access_token: string;
      expires_in?: number;
    };
    return {
      ...token,
      accessToken: j.access_token,
      expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    };
  }

  async revokeToken(token: PlatformToken): Promise<void> {
    ensureOAuth2Token(token);
    try {
      await rpcCall('/2/auth/token/revoke', token.accessToken, null);
    } catch {
      // best-effort
    }
  }

  async getAccountInfo(token: PlatformToken): Promise<PlatformAccountInfo> {
    ensureOAuth2Token(token);
    const r = await rpcCall('/2/users/get_current_account', token.accessToken, null);
    if (!r.ok) throw await readDropboxError(r);
    const j = (await r.json()) as DropboxAccountResponse;
    return {
      platformUserId: j.account_id,
      username: j.email,
      displayName: j.name?.display_name,
    };
  }

  async listGalleries(token: PlatformToken, opts: { cursor?: string | null; limit?: number } = {}): Promise<{
    galleries: PlatformGallery[];
    nextCursor: string | null;
  }> {
    ensureOAuth2Token(token);
    // Dropbox doesn't have a "list root folders only" endpoint, but
    // list_folder with path="" + recursive=false gives us top-level
    // entries. We filter to folders.
    let r: Response;
    if (opts.cursor) {
      r = await rpcCall('/2/files/list_folder/continue', token.accessToken, { cursor: opts.cursor });
    } else {
      r = await rpcCall('/2/files/list_folder', token.accessToken, {
        path: '',
        recursive: false,
        include_media_info: false,
        include_deleted: false,
        include_has_explicit_shared_members: false,
        include_mounted_folders: true,
        limit: Math.min(opts.limit ?? 200, 2000),
      });
    }
    if (!r.ok) throw await readDropboxError(r);
    const j = (await r.json()) as DropboxListResponse;
    const galleries: PlatformGallery[] = j.entries
      .filter((e): e is DropboxFolderEntry => e['.tag'] === 'folder')
      .map((f) => ({
        id: f.path_lower,
        name: f.name,
      }));
    return { galleries, nextCursor: j.has_more ? j.cursor : null };
  }

  async listPhotos(token: PlatformToken, galleryId: string, opts: ListPhotosOptions = {}): Promise<ListPhotosResult> {
    ensureOAuth2Token(token);
    let r: Response;
    if (opts.cursor) {
      r = await rpcCall('/2/files/list_folder/continue', token.accessToken, { cursor: opts.cursor });
    } else {
      r = await rpcCall('/2/files/list_folder', token.accessToken, {
        path: galleryId,
        recursive: false,
        include_media_info: true,
        include_deleted: false,
        limit: Math.min(opts.limit ?? 500, 2000),
      });
    }
    if (!r.ok) throw await readDropboxError(r);
    const j = (await r.json()) as DropboxListResponse;
    const photos: PlatformPhoto[] = j.entries
      .filter((e): e is DropboxFileEntry => e['.tag'] === 'file')
      .filter(isAcceptedFile)
      .map((f) => {
        const mime = mimeFromName(f.name);
        const dims = f.media_info?.metadata?.dimensions;
        return {
          id: f.path_lower,
          filename: f.name,
          width: dims?.width ?? 0,
          height: dims?.height ?? 0,
          size: f.size,
          // Thumbnail URLs are not direct — we proxy them. The route
          // /api/photo-platforms/thumbnail?platform=dropbox&token=...&path=...
          // streams from get_thumbnail_v2 on demand.
          thumbnailUrl: `/api/photo-platforms/thumbnail?platform=dropbox&path=${encodeURIComponent(f.path_lower)}`,
          contentType: mime ?? 'image/jpeg',
          capturedAt: f.media_info?.metadata?.time_taken ?? f.client_modified,
        };
      });
    return { photos, nextCursor: j.has_more ? j.cursor : null };
  }

  async downloadOriginal(token: PlatformToken, _galleryId: string, photoId: string): Promise<DownloadedPhoto> {
    ensureOAuth2Token(token);
    // Dropbox /2/files/download uses the Dropbox-API-Arg header for the
    // path (because the body itself is the file bytes). The response is
    // a stream we hand straight to the caller.
    const r = await fetch(`${CONTENT_BASE}/2/files/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: photoId }),
      },
    });
    if (!r.ok || !r.body) throw await readDropboxError(r);

    // Pull filename from the result header
    const meta = r.headers.get('dropbox-api-result');
    let filename = 'photo';
    let contentType = r.headers.get('content-type') ?? 'application/octet-stream';
    if (meta) {
      try {
        const m = JSON.parse(meta) as { name?: string };
        if (m.name) filename = m.name;
      } catch {
        /* ignore */
      }
    }
    // Force a sane content type if Dropbox returns octet-stream
    if (contentType === 'application/octet-stream') {
      const mime = mimeFromName(filename);
      if (mime) contentType = mime;
    }
    if (!ACCEPTED_MIME.has(contentType)) {
      throw new PlatformError('unknown', `Refusing non-image content type: ${contentType}`);
    }
    const len = parseInt(r.headers.get('content-length') || '0', 10);
    return {
      body: r.body,
      contentType,
      contentLength: Number.isFinite(len) && len > 0 ? len : undefined,
      filename,
    };
  }
}
