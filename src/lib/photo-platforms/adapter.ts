// src/lib/photo-platforms/adapter.ts
//
// The platform abstraction layer.
//
// Every supported source (SmugMug, Dropbox, future: Pic-Time, ShootProof,
// ...) implements this interface. The rest of the app only ever talks to
// PhotoPlatformAdapter — never to a platform-specific SDK or fetch.
//
// Adding a platform = writing one new file that exports a class
// implementing this interface, plus a row in the registry in `index.ts`.
//
// Two flavours of method:
//   - "Account-level" — initiating OAuth, refreshing tokens. Doesn't
//     need a connected account yet; takes raw app credentials.
//   - "Token-bound" — anything that touches a photographer's content.
//     Always takes a Token object so the adapter knows whose data to
//     fetch and stays stateless between calls.
//
// All methods are async and return either typed data or throw a
// PlatformError. Adapters MUST translate platform-specific errors into
// the categories below so the rest of the app handles them uniformly.

/* ─── Token shape ──────────────────────────────────────────────────── */

/**
 * Discriminated union of token shapes per OAuth flavour.
 *
 * - oauth2: Dropbox, Pic-Time, anything modern. accessToken expires;
 *           refreshToken renews it.
 * - oauth1: SmugMug. accessToken + accessTokenSecret are permanent until
 *           the user revokes them. No refresh needed.
 *
 * The adapter type is the platform's key in the registry — used by
 * callers to discriminate without depending on adapter classes.
 */
export type PlatformToken =
  | {
      kind: 'oauth2';
      platform: string;
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number; // ms epoch
    }
  | {
      kind: 'oauth1';
      platform: string;
      accessToken: string;
      accessTokenSecret: string;
    };

/* ─── Domain types ─────────────────────────────────────────────────── */

export interface PlatformAccountInfo {
  /** Stable, platform-side user id. We persist this with the token. */
  platformUserId: string;
  /** Human-readable name we surface to the photographer
   *  ("Connected as @joephoto"). */
  username: string;
  /** Optional display name (full name). */
  displayName?: string;
}

export interface PlatformGallery {
  /** Stable ID we use to list photos. SmugMug album key, Dropbox folder path, etc. */
  id: string;
  /** Photographer-facing name. */
  name: string;
  /** Approximate count; some platforms only give us this on a follow-up call. */
  photoCount?: number;
  /** Last-modified timestamp, ms epoch. Lets the dashboard show "updated 3d ago". */
  updatedAt?: number;
  /** Optional thumbnail URL of a representative cover photo. */
  coverUrl?: string;
}

export interface PlatformPhoto {
  /** Stable ID for this photo within the gallery. */
  id: string;
  /** Original filename if available. */
  filename: string;
  /** Pixel dimensions. */
  width: number;
  height: number;
  /** File size in bytes if known. Some platforms only return this on detail fetch. */
  size?: number;
  /** Best thumbnail URL for the client gallery grid. Should be ~400-800px on the long edge. */
  thumbnailUrl: string;
  /** MIME type — only JPEG/HEIC/PNG/AVIF accepted; adapters MUST filter others. */
  contentType: 'image/jpeg' | 'image/heic' | 'image/png' | 'image/avif';
  /** ISO timestamp when the photo was captured / uploaded. */
  capturedAt?: string;
}

export interface ListPhotosOptions {
  /** Cursor for pagination. null/undefined = first page. */
  cursor?: string | null;
  /** Page size cap (adapter may clamp). */
  limit?: number;
}

export interface ListPhotosResult {
  photos: PlatformPhoto[];
  /** null when listing is complete. */
  nextCursor: string | null;
}

export interface DownloadedPhoto {
  /** A ReadableStream the caller pipes straight to R2 — never read into memory. */
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: number;
  /** Filename to suggest for storage. */
  filename: string;
}

/* ─── Errors ───────────────────────────────────────────────────────── */

/**
 * Common categories every adapter must use. The error-handling matrix
 * in the blueprint maps these to user-facing behaviours.
 */
export type PlatformErrorCode =
  | 'auth_revoked' // 401 — user revoked our access, ask to reconnect
  | 'auth_expired' // 401 — token expired (for OAuth2, caller should refresh)
  | 'insufficient_scope' // 403 — we're missing a permission, photographer needs to re-authorize with new scopes
  | 'rate_limited' // 429 — platform throttled us
  | 'not_found' // 404 — photo/gallery removed or never existed
  | 'downloads_disabled' // SmugMug — photographer turned off downloads
  | 'platform_down' // 5xx — retry with backoff
  | 'network' // fetch threw
  | 'unknown';

export class PlatformError extends Error {
  code: PlatformErrorCode;
  retryAfterSeconds?: number;
  detail?: unknown;
  constructor(code: PlatformErrorCode, message: string, opts: { retryAfterSeconds?: number; detail?: unknown } = {}) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.detail = opts.detail;
  }
}

/* ─── OAuth flow types ─────────────────────────────────────────────── */

export interface OAuthStartResult {
  /** URL we redirect the photographer to. */
  authorizeUrl: string;
  /**
   * Anything the adapter needs to remember across the redirect.
   * Stored in KV under a short-lived key keyed by the OAuth `state` param.
   * For OAuth1 (SmugMug) this carries the request-token secret.
   * For OAuth2 (Dropbox) this is usually `{}`.
   */
  flowState: Record<string, string>;
}

export interface OAuthCompleteInput {
  /** Everything from the callback URL's query string. */
  callbackParams: Record<string, string>;
  /** The flowState we stashed in `oauthStart`. */
  flowState: Record<string, string>;
}

export interface OAuthCompleteResult {
  token: PlatformToken;
  account: PlatformAccountInfo;
}

/* ─── The adapter interface ────────────────────────────────────────── */

export interface PhotoPlatformAdapter {
  /** Stable identifier — also the value of `token.platform`. */
  readonly platformId: string;
  /** Human-facing name for UI ("SmugMug", "Dropbox"). */
  readonly displayName: string;

  /** Begin OAuth — returns the URL we redirect the photographer to. */
  oauthStart(input: { redirectUri: string; csrfState: string }): Promise<OAuthStartResult>;

  /** Complete OAuth — exchange the callback for a long-lived token. */
  oauthComplete(input: OAuthCompleteInput & { redirectUri: string }): Promise<OAuthCompleteResult>;

  /** Refresh an expired access token (OAuth2 only — adapters with permanent tokens return the input unchanged). */
  refreshToken(token: PlatformToken): Promise<PlatformToken>;

  /**
   * Revoke the token on the platform side, freeing the photographer
   * from any consent screens next time they reconnect. Best-effort —
   * if the call fails we still treat the connection as disconnected
   * locally.
   */
  revokeToken(token: PlatformToken): Promise<void>;

  /** Who is this token attached to? Used post-OAuth to display "Connected as ...". */
  getAccountInfo(token: PlatformToken): Promise<PlatformAccountInfo>;

  /** List the photographer's galleries/folders. Paginated. */
  listGalleries(token: PlatformToken, opts?: { cursor?: string | null; limit?: number }): Promise<{
    galleries: PlatformGallery[];
    nextCursor: string | null;
  }>;

  /** List photos in a specific gallery. */
  listPhotos(token: PlatformToken, galleryId: string, opts?: ListPhotosOptions): Promise<ListPhotosResult>;

  /**
   * Stream the original of one photo. Caller pipes the body into R2 or
   * any other sink — adapters MUST NOT load the body into memory.
   */
  downloadOriginal(token: PlatformToken, galleryId: string, photoId: string): Promise<DownloadedPhoto>;
}
