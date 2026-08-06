/**
 * Offline-ready cache for frequently used media (metadata + small blobs).
 * Sales can preview recently used brochures during temporary connectivity issues.
 */

const DB_NAME = "mm-media-offline";
const DB_VERSION = 1;
const META_STORE = "meta";
const BLOB_STORE = "blobs";
const MAX_CACHED = 30;
const MAX_BLOB_BYTES = 8 * 1024 * 1024; // 8 MB per file in offline cache

export type CachedMediaMeta = {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  cachedAt: number;
  lastUsedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IDB open failed"));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listOfflineMedia(): Promise<CachedMediaMeta[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const all = await idbReq(store.getAll() as IDBRequest<CachedMediaMeta[]>);
    db.close();
    return (all || []).sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  } catch {
    return [];
  }
}

export async function getOfflineBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(BLOB_STORE, "readonly");
    const row = await idbReq(
      tx.objectStore(BLOB_STORE).get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>
    );
    db.close();
    return row?.blob || null;
  } catch {
    return null;
  }
}

export async function cacheMediaOffline(opts: {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  blob?: Blob;
}): Promise<void> {
  try {
    const db = await openDb();
    const now = Date.now();
    const meta: CachedMediaMeta = {
      id: opts.id,
      name: opts.name,
      originalName: opts.originalName,
      mimeType: opts.mimeType,
      kind: opts.kind,
      sizeBytes: opts.sizeBytes,
      cachedAt: now,
      lastUsedAt: now,
    };
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).put(meta);
    if (opts.blob && opts.blob.size <= MAX_BLOB_BYTES) {
      tx.objectStore(BLOB_STORE).put({ id: opts.id, blob: opts.blob });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Evict oldest beyond MAX_CACHED
    const all = await listOfflineMedia();
    if (all.length > MAX_CACHED) {
      const toRemove = all.slice(MAX_CACHED);
      const db2 = await openDb();
      const tx2 = db2.transaction([META_STORE, BLOB_STORE], "readwrite");
      for (const r of toRemove) {
        tx2.objectStore(META_STORE).delete(r.id);
        tx2.objectStore(BLOB_STORE).delete(r.id);
      }
      await new Promise<void>((resolve, reject) => {
        tx2.oncomplete = () => resolve();
        tx2.onerror = () => reject(tx2.error);
      });
      db2.close();
    }
    db.close();
  } catch {
    /* best-effort */
  }
}

export async function touchOfflineMedia(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const row = await idbReq(store.get(id) as IDBRequest<CachedMediaMeta | undefined>);
    if (row) {
      row.lastUsedAt = Date.now();
      store.put(row);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function removeOfflineMedia(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([META_STORE, BLOB_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(BLOB_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore */
  }
}

/** Fetch file with token and cache for offline if size allows */
export async function fetchAndCacheMedia(
  apiBase: string,
  token: string,
  asset: {
    id: string;
    name: string;
    originalName: string;
    mimeType: string;
    kind: string;
    sizeBytes: number;
  }
): Promise<Blob | null> {
  try {
    const res = await fetch(`${apiBase}/media/assets/${asset.id}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    await cacheMediaOffline({ ...asset, blob });
    return blob;
  } catch {
    // Offline — try cache
    return getOfflineBlob(asset.id);
  }
}
