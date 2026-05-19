/**
 * client-auth — HMAC-signed cookie proving a client verified their email.
 *
 * This is a soft lead-gate (not bank-grade auth): once a client enters
 * the code we emailed, we set a signed cookie so they don't have to
 * re-verify on every visit. The cookie is tamper-proof (HMAC) and
 * expires, so it can't be hand-forged.
 *
 * Cookie shape: `ff_client=<expiresAt>.<emailB64url>.<hmac>`
 *   - expiresAt : ms since epoch the cookie is valid until
 *   - emailB64url: the verified email, base64url
 *   - hmac      : HMAC-SHA256 of `<expiresAt>.<emailB64url>` keyed by secret
 *
 * HttpOnly + Secure + SameSite=Lax (Lax so a normal top-level visit
 * still sends it). Signing secret is whatever stable server secret is
 * available — no new env required.
 */

const ENCODER = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlStr(s: string): string {
  return b64url(ENCODER.encode(s));
}

function fromB64urlStr(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      Array.from(atob(pad))
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
  } catch {
    try {
      return atob(pad);
    } catch {
      return '';
    }
  }
}

async function hmac(message: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, ENCODER.encode(message));
  return b64url(new Uint8Array(sig));
}

const COOKIE = 'ff_client';

export async function buildClientCookie(
  secret: string,
  email: string,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
): Promise<string> {
  const expiresAt = Date.now() + ttlMs;
  const emailB64 = b64urlStr(email.toLowerCase());
  const sig = await hmac(`${expiresAt}.${emailB64}`, secret);
  const value = `${expiresAt}.${emailB64}.${sig}`;
  const expires = new Date(expiresAt).toUTCString();
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}

export function clearClientCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readRaw(req: Request): string | null {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)ff_client=([^;]+)/);
  return m ? m[1] : null;
}

/** Returns the verified email if the cookie is present, unexpired and
 *  correctly signed; otherwise null. */
export async function verifyClientCookie(
  req: Request,
  secret: string,
): Promise<string | null> {
  const raw = readRaw(req);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [expStr, emailB64, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = await hmac(`${expStr}.${emailB64}`, secret);
  // constant-ish time compare
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const email = fromB64urlStr(emailB64);
  return email || null;
}
