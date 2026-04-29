'use client';

/**
 * DownloadAll — fetches every photo for an order in the browser and
 * bundles them into a single ZIP file.
 *
 * Why client-side: Cloudflare Workers' edge runtime has tight CPU /
 * memory limits per request, and a 200 MB ZIP for 40 photos is right
 * at the edge of what's safe. The admin browser, by contrast, has
 * gigs of RAM and an unlimited stream. JSZip from cdnjs handles
 * the heavy lifting.
 *
 * Progress text updates as photos are fetched so Jayvee knows it's
 * working. Errors per-photo don't stop the whole job — partial ZIP
 * is still useful.
 */

import { useState } from 'react';

interface JSZipFile {
  file(name: string, data: ArrayBuffer): void;
  generateAsync(options: { type: string }): Promise<Blob>;
}
interface JSZipCtor {
  new (): JSZipFile;
}

declare global {
  interface Window {
    JSZip?: JSZipCtor;
  }
}

async function loadJSZip(): Promise<JSZipCtor> {
  if (typeof window === 'undefined') throw new Error('not in browser');
  if (window.JSZip) return window.JSZip;
  await new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Could not load JSZip'));
    document.head.appendChild(s);
  });
  if (!window.JSZip) throw new Error('JSZip did not register on window');
  return window.JSZip;
}

export default function DownloadAll({
  orderId,
  photos,
}: {
  orderId: string;
  photos: { id: string; url: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  async function start() {
    if (busy || photos.length === 0) return;
    setBusy(true);
    setProgress(0);
    setErrors([]);
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      let done = 0;
      const localErrors: string[] = [];
      for (const p of photos) {
        try {
          const res = await fetch(p.url, { credentials: 'same-origin' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          // Use the photo id (already includes the extension) as the
          // file name; collisions impossible since R2 keys are unique.
          const guess = guessName(p.url, p.id);
          zip.file(guess, buf);
        } catch (e) {
          localErrors.push(`${p.id}: ${e instanceof Error ? e.message : 'failed'}`);
        }
        done++;
        setProgress(done);
      }
      if (localErrors.length) setErrors(localErrors);
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${orderId || 'album'}-photos.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so the download has time to start.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'unknown error']);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-download-wrap">
      <button
        type="button"
        className="admin-action-primary"
        onClick={start}
        disabled={busy || photos.length === 0}
      >
        {busy
          ? `Bundling ${progress} / ${photos.length}…`
          : `Download all photos (.zip)`}
      </button>
      {errors.length > 0 ? (
        <div className="admin-download-errors">
          {errors.length} photo{errors.length === 1 ? '' : 's'} failed:
          <ul>
            {errors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {errors.length > 5 ? <li>…and {errors.length - 5} more</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Given a URL like "/api/photo/designs/{designId}/{id}.jpg", pull
 * the trailing filename for use as the ZIP entry name. Falls back to
 * the supplied id with .jpg.
 */
function guessName(url: string, id: string): string {
  try {
    const u = new URL(url, 'https://_');
    const seg = u.pathname.split('/').filter(Boolean);
    const last = seg[seg.length - 1];
    if (last && /\.\w+$/.test(last)) return last;
  } catch { /* ignore */ }
  return `${id}.jpg`;
}
