/**
 * photographer-auth — HMAC cookie + magic-link helpers.
 *
 * Why magic-link instead of password:
 *   - photographers WILL forget a password and email Jayvee for help
 *   - we already have Resend wired for email
 *   - sessions persist 30 days so it feels "logged in" not "constantly checking email"
 *   - no password storage = no breach risk on photographer credentials
 *
 * Signing key: reuses ADMIN_PASSWORD as the HMAC secret. If you rotate
 * ADMIN_PASSWORD, all photographer sessions invalidate — rare event,
 * acceptable trade-off for not introducing another secret to manage.
 *
 * Cookie shape: `pro_session=<accountId>.<expiresAt>.<base64url-hmac>`
 *   - accountId: 10-hex KV ID for the photographer
 *   - expiresAt: ms-since-epoch the cookie is valid until
 *   - hmac: HMAC-SHA256 of `<accountId>.<expiresAt>` keyed by ADMIN_PASSWORD
 */

const ENC = new TextEncoder();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAGIC_TTL_MS = 15 * 60 * 1000; // 15-minute magic link window

async function hmac(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ENC.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, ENC.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function buildProSessionCookie(
  accountId: string,
  secret: string,
): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${accountId}.${expiresAt}`;
  const sig = await hmac(payload, secret);
  const value = `${payload}.${sig}`;
  const expires = new Date(expiresAt).toUTCString();
  return `pro_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`;
}

export function clearProSessionCookie(): string {
  return 'pro_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

/**
 * Validate the photographer session cookie. Returns the accountId on
 * success, null if missing / expired / tampered.
 */
export async function readProSession(
  req: Request,
  secret: string | undefined,
): Promise<string | null> {
  if (!secret) return null;
  const value = readCookie(req, 'pro_session');
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [accountId, expStr, sig] = parts;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  const expected = await hmac(`${accountId}.${expiresAt}`, secret);
  if (sig.length !== expected.length) return null;
  let ok = 0;
  for (let i = 0; i < sig.length; i++) {
    ok |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return ok === 0 ? accountId : null;
}

export async function readProSessionFromCookieHeader(
  cookieHeader: string,
  secret: string | undefined,
): Promise<string | null> {
  if (!secret || !cookieHeader) return null;
  const fakeReq = new Request('https://example.com', {
    headers: { cookie: cookieHeader },
  });
  return readProSession(fakeReq, secret);
}

/**
 * Mint a one-time magic-link token. Caller persists `{ accountId,
 * expiresAt }` in KV under a 15-min-TTL key, then emails the URL.
 */
export function newMagicToken(): { token: string; expiresAt: number } {
  // 32 random hex chars — way more than enough entropy for a 15-min link.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { token, expiresAt: Date.now() + MAGIC_TTL_MS };
}

/** Generate the 10-hex accountId we use as the KV key suffix for a
 *  photographer record. UUID-derived, no PII. */
export function newAccountId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}
