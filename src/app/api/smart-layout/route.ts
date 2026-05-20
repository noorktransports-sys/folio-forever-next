/**
 * POST /api/smart-layout
 *
 * The smart album engine runs HERE, on the server — not in the browser.
 * The client sends only tiny photo METADATA (id, w, h, tag, event,
 * blurry flag), never image bytes. We return the spread plan.
 *
 * This is the IP boundary: a competitor opening DevTools sees only this
 * request/response, never how heroes are auto-picked, how the album is
 * paced, or how layouts are chosen.
 *
 * Body: {
 *   photos: LayoutPhoto[],
 *   pageCount: number,
 *   type: 'standard' | 'layflat',
 *   spreadAspectRatio: number,
 *   style?: 'clean' | 'bold' | 'mix',
 *   shuffle?: boolean        // regenerate = reshuffle then re-plan
 * }
 * Returns: { spreads: Spread[] }
 */

import { generateLayout } from '@/lib/smart-layout/engine'
import type {
  LayoutPhoto,
  AlbumType,
  AlbumStyle,
} from '@/lib/smart-layout/templates'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

interface Body {
  photos?: LayoutPhoto[]
  pageCount?: number
  type?: AlbumType
  spreadAspectRatio?: number
  style?: AlbumStyle
  shuffle?: boolean
}

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return bad('Invalid JSON')
  }

  const { photos, pageCount, type, spreadAspectRatio } = body
  if (!Array.isArray(photos)) return bad('photos must be an array')
  if (typeof pageCount !== 'number' || pageCount <= 0) return bad('Invalid pageCount')
  if (type !== 'standard' && type !== 'layflat') return bad('Invalid type')
  if (typeof spreadAspectRatio !== 'number' || !Number.isFinite(spreadAspectRatio)) {
    return bad('Invalid spreadAspectRatio')
  }
  const style: AlbumStyle =
    body.style === 'clean' || body.style === 'bold' ? body.style : 'mix'

  // Defensive: only keep the fields the engine uses, so a malformed
  // payload can't smuggle anything in.
  const clean: LayoutPhoto[] = photos
    .filter((p) => p && typeof p.id === 'string')
    .map((p) => ({
      id: p.id,
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
      tagged:
        p.tagged === 'hero' || p.tagged === 'favorite' ? p.tagged : 'none',
      blurry: !!p.blurry,
      eventId: p.eventId,
      capturedAt:
        typeof p.capturedAt === 'number' && Number.isFinite(p.capturedAt)
          ? p.capturedAt
          : undefined,
      seqNum:
        typeof p.seqNum === 'number' && Number.isFinite(p.seqNum)
          ? p.seqNum
          : undefined,
    }))

  const ordered = body.shuffle
    ? [...clean].sort(() => Math.random() - 0.5)
    : clean

  try {
    const spreads = generateLayout(
      ordered,
      pageCount,
      type,
      spreadAspectRatio,
      style,
    )
    return new Response(JSON.stringify({ spreads }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return bad(
      `Layout engine failed: ${err instanceof Error ? err.message : 'unknown'}`,
      500,
    )
  }
}
