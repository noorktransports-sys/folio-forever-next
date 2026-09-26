// src/lib/rate-limit.ts
//
// Simple per-IP limits backed by KV (fixed windows). KV is eventually
// consistent, so a burst can slip a few requests past the limit — this is
// a brake against scripted abuse, not an exact counter. For hard limits,
// also add a Cloudflare "Rate limiting rule" on these paths.

export interface RateKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
}

/**
 * Count one hit for `bucket` from this IP. Returns false when the limit
 * for the current window is already reached. Fails OPEN if KV is missing
 * or errors (never blocks real customers because of a storage hiccup).
 */
export async function allowRequest(
  kv: RateKV | undefined,
  request: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!kv) return true
  try {
    const win = Math.floor(Date.now() / 1000 / windowSeconds)
    const key = `rl:${bucket}:${clientIp(request)}:${win}`
    const n = Number((await kv.get(key)) ?? 0)
    if (n >= limit) return false
    await kv.put(key, String(n + 1), { expirationTtl: Math.max(60, windowSeconds * 2) })
    return true
  } catch {
    return true
  }
}

export function tooMany(message = 'Too many requests — please wait a few minutes and try again'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '300' },
  })
}
