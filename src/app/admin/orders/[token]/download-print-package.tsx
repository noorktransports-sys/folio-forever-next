'use client';

/**
 * DownloadPrintPackage — one-click ZIP of every file the print lab
 * needs to print the album:
 *
 *   • cover-front.jpg  (print-quality, 300 DPI for the album face)
 *   • cover-back.jpg   (photo covers only)
 *   • spread-NN.jpg    (one per spread, print-quality)
 *   • MANIFEST.txt     (order id, customer, shipping, album spec,
 *                       cover spec, totals, dates — everything the
 *                       lab needs without opening the dashboard)
 *
 * Bundling runs client-side (JSZip via cdnjs) so a 200 MB package
 * never hits the edge worker's CPU / memory caps. The browser has
 * gigs of RAM and an unlimited stream.
 *
 * This is the ONLY bulk download on the admin order page. Originals
 * are still individually downloadable from the photo grid below
 * (click → right-click → Save image as) for the rare case where a
 * specific original is needed.
 */

import { useState } from 'react';

interface JSZipFile {
  file(name: string, data: ArrayBuffer | string): void;
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

export interface PrintFile {
  url: string;
  /** Filename inside the ZIP, e.g. "spread-01.jpg" */
  name: string;
}

export default function DownloadPrintPackage({
  orderId,
  files,
  manifestText,
}: {
  orderId: string;
  files: PrintFile[];
  manifestText: string;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  async function start() {
    if (busy || files.length === 0) return;
    setBusy(true);
    setProgress(0);
    setErrors([]);
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      let done = 0;
      const localErrors: string[] = [];

      // 1) MANIFEST.txt first so it's at the top of the ZIP listing.
      zip.file('MANIFEST.txt', manifestText);

      // 2) Every print file, fetched in sequence so progress is honest.
      for (const f of files) {
        try {
          const res = await fetch(f.url, { credentials: 'same-origin' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          zip.file(f.name, buf);
        } catch (e) {
          localErrors.push(
            `${f.name}: ${e instanceof Error ? e.message : 'failed'}`,
          );
        }
        done++;
        setProgress(done);
      }
      if (localErrors.length) setErrors(localErrors);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${orderId || 'album'}-print.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
        disabled={busy || files.length === 0}
        title={
          files.length === 0
            ? 'No print files yet — composites + cover render at submit time.'
            : `Bundles ${files.length} print files + MANIFEST.txt into one ZIP for the print lab.`
        }
      >
        {busy
          ? `Bundling ${progress} / ${files.length}…`
          : `📦 Download layouts for print (.zip)`}
      </button>
      {errors.length > 0 ? (
        <div className="admin-download-errors">
          {errors.length} file{errors.length === 1 ? '' : 's'} failed:
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
