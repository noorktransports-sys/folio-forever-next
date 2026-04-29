/**
 * /album/[token] — read-only album viewer.
 *
 * This is what the share link points to. Customers and the people they
 * share with (photographer, family, the wedding planner) land here, NOT
 * back in the editor. Read-only by design — no slot drag-drop, no
 * "save" buttons. Just: cover → spread carousel → end card.
 *
 * Why a separate route from /design:
 *   1. The builder URL is mutable working space; the album URL is the
 *      finished artifact. Conflating the two means people land in the
 *      editor every time they click a link, "fix" something, hit save,
 *      and generate yet another token. Owner inbox spam.
 *   2. View-mode chrome (full-bleed, no toolbar, keyboard nav) is wrong
 *      for the editor and editor chrome is wrong for the viewer.
 *
 * Edge runtime — fetches the design JSON straight from KV (DESIGN_DRAFTS)
 * server-side so first paint already has the data. Falls back to a
 * "not found / expired" card with a CTA back to /design when the token
 * doesn't resolve.
 *
 * Original-customer detection happens client-side: if the device has the
 * same email in localStorage as the design's customer, an "Edit this
 * design" link is shown. A photographer/friend opening the same URL
 * sees no edit affordance.
 */

import { getRequestContext } from '@cloudflare/next-on-pages';
import Link from 'next/link';
import AlbumViewer, { type SavedDesign } from './album-viewer';
import './album-viewer.css';

export const runtime = 'edge';

interface KVNamespace {
  get(key: string): Promise<string | null>;
}
interface Env {
  DESIGN_DRAFTS?: KVNamespace;
}

async function loadDesign(token: string): Promise<SavedDesign | null> {
  if (!/^[a-f0-9]{8,64}$/i.test(token)) return null;
  try {
    const { env } = getRequestContext() as { env: Env };
    if (!env.DESIGN_DRAFTS) return null;
    const json = await env.DESIGN_DRAFTS.get(token);
    if (!json) return null;
    const parsed = JSON.parse(json) as SavedDesign;
    return parsed;
  } catch {
    return null;
  }
}

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const design = await loadDesign(token);

  if (!design) {
    return (
      <main className="album-not-found">
        <div className="album-nf-card">
          <div className="album-nf-tag">Link expired or not found</div>
          <h1>This album link can&rsquo;t be opened</h1>
          <p>
            Saved albums stay live for 60 days. After that they&rsquo;re
            cleared so we&rsquo;re not holding photos longer than promised.
          </p>
          <Link href="/design" className="album-nf-cta">
            Start a new album
          </Link>
        </div>
      </main>
    );
  }

  return <AlbumViewer design={design} token={token} />;
}
