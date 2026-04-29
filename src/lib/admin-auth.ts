/**
 * admin-auth — shared HMAC-cookie helpers used by every /admin route.
 *
 * Why not Cloudflare Access right now: Jayvee needs to test the order
 * pipeline today and "set ADMIN_PASSWORD as a secret" beats waiting for
 * Access app + identity provider config. We'll cut over to Access before
 * any real customer data lives in here. Ticket on the board.
 *
 * Cookie shape: `admin_session=<expiresAt>.<base64url-hmac>`
 *   - expiresAt: ms since epoch the cookie is valid until
 *   - hmac: HMAC-SHA256 of `<expiresAt>` keyed by ADMIN_PASSWORD
 *
 * The cookie is HttpOnly + Secure + SameSite=Strict. Server signs with
 * the same env.ADMIN_PASSWORD it's checking against on login, so there's
 * no separate secret to manage. If someone rotates the password, all
 * existing sessions invalidate naturally.
 */

const ENCODER = new TextEncoder();

async function hmac(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, ENCODER.encode(message));
  // base64url
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function buildSessionCookie(
  password: string,
  ttlMs = 24 * 60 * 60 * 1000,
): Promise<string> {
  const expiresAt = Date.now() + ttlMs;
  const sig = await hmac(String(expiresAt), password);
  const value = `${expiresAt}.${sig}`;
  // Set-Cookie attributes — HttpOnly stops JS reads, Secure forces
  // HTTPS, SameSite=Strict blocks cross-site abuse.
  const expires = new Date(expiresAt).toUTCString();
  return `admin_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`;
}

export function clearSessionCookie(): string {
  return 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

export function readSessionCookie(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Validate the admin_session cookie. Returns true only if the HMAC
 * matches the current ADMIN_PASSWORD AND the timestamp hasn't expired.
 */
export async function isAuthed(
  req: Request,
  password: string | undefined,
): Promise<boolean> {
  if (!password) return false;
  const value = readSessionCookie(req);
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot < 0) return false;
  const expiresAt = Number(value.slice(0, dot));
  const sig = value.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = await hmac(String(expiresAt), password);
  // Constant-time-ish equality. Strings are short so naive compare is OK.
  if (sig.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < sig.length; i++) {
    ok |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return ok === 0;
}

/**
 * For server components: turn a Request-equivalent object into
 * an authed boolean. Next 15's `cookies()` helper is awaitable;
 * server pages call this with the headers().get('cookie') result.
 */
export async function isAuthedFromCookieHeader(
  cookieHeader: string,
  password: string | undefined,
): Promise<boolean> {
  if (!password || !cookieHeader) return false;
  const fakeReq = new Request('https://example.com', {
    headers: { cookie: cookieHeader },
  });
  return isAuthed(fakeReq, password);
}
