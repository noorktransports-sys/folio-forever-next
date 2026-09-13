// src/app/design/smart/edit/photo-blob-store.ts
//
// Fix for "uploaded photos disappear after refresh" (HANDOFF_SMART bug #1).
//
// Uploaded photos are referenced by blob: URLs from URL.createObjectURL.
// The browser invalidates those URLs on page reload, so saving them to
// localStorage is pointless — only the FILE blob itself survives a refresh
// if you put it somewhere that does. IndexedDB is the right fit:
//   - Stores Blob/File objects natively (no base64 inflation)
//   - Quota is generous (~hundreds of MB on most browsers)
//   - Async API; doesn't block the main thread
//
// Per-album scoping is done via a composite key `${albumId}::${photoId}`.
// The `clearAlbumBlobs` helper sweeps just one album's blobs (for Start New).
//
// All helpers are no-ops if `window` or `indexedDB` is unavailable (edge
// runtime SSR, private-browsing modes that disable IDB) — they fail silently
// so the wizard still works without persistence in those cases.

const DB_NAME = 'folio-smart-photos'
const STORE = 'blobs'
const DB_VERSION = 1

const isBrowser = typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'))
  })
}

const composite = (albumId: string, photoId: string) => `${albumId}::${photoId}`

/** Persist one File/Blob under a composite key. Silent on failure. */
export async function saveBlob(
  albumId: string,
  photoId: string,
  blob: Blob,
): Promise<void> {
  if (!isBrowser) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, composite(albumId, photoId))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB save failed'))
    })
  } catch (err) {
    console.warn('[photo-blob-store] save failed', err)
  }
}

/**
 * Read every blob belonging to an album and return a Map of photoId →
 * fresh object URL. The caller is responsible for revoking the URLs
 * when they're no longer needed (most apps just leak them per-session
 * since the browser GCs on tab close).
 */
export async function loadAlbumBlobs(albumId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!isBrowser) return map
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        const k = cursor.key as string
        const prefix = `${albumId}::`
        if (k.startsWith(prefix)) {
          const photoId = k.slice(prefix.length)
          try {
            map.set(photoId, URL.createObjectURL(cursor.value as Blob))
          } catch {
            /* malformed blob — skip */
          }
        }
        cursor.continue()
      }
      req.onerror = () => resolve()
    })
  } catch (err) {
    console.warn('[photo-blob-store] load failed', err)
  }
  return map
}

/** Remove one photo's blob (used when the user removes a photo entirely). */
export async function deleteBlob(albumId: string, photoId: string): Promise<void> {
  if (!isBrowser) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(composite(albumId, photoId))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB delete failed'))
    })
  } catch (err) {
    console.warn('[photo-blob-store] delete failed', err)
  }
}

/** Wipe every blob belonging to an album (Start New). */
export async function clearAlbumBlobs(albumId: string): Promise<void> {
  if (!isBrowser) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        const k = cursor.key as string
        if (k.startsWith(`${albumId}::`)) {
          cursor.delete()
        }
        cursor.continue()
      }
      req.onerror = () => resolve()
    })
  } catch (err) {
    console.warn('[photo-blob-store] clear failed', err)
  }
}
