"use client";

/**
 * Offline outbox (Spec §4): field forms write here when the network is down.
 * Entries carry a client-generated UUID + the device timestamp at time of
 * action (not sync time). The server treats clientUuid as an idempotency key,
 * so retries never duplicate records.
 */

export interface OutboxEntry {
  id: string; // client UUID, also sent as clientUuid
  url: string;
  method: string;
  body: unknown;
  label: string; // human description shown in sync UI
  createdAt: string; // device time at moment of action
  lastError?: string;
}

const DB_NAME = "maxey-outbox";
const STORE = "outbox";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function notifyChange() {
  window.dispatchEvent(new CustomEvent("outbox-change"));
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
  await tx("readwrite", (s) => s.put(entry));
  notifyChange();
  // Ask the service worker to register a background sync if supported
  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    const sync = (reg as unknown as { sync?: { register(tag: string): Promise<void> } })?.sync;
    if (sync) await sync.register("outbox-sync").catch(() => {});
  }
}

export async function listPending(): Promise<OutboxEntry[]> {
  return tx("readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
}

export async function pendingCount(): Promise<number> {
  return tx("readonly", (s) => s.count());
}

async function remove(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

/** Push all queued entries to the server. Returns number successfully synced. */
export async function flush(): Promise<number> {
  const entries = await listPending();
  let synced = 0;
  for (const entry of entries) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.body),
      });
      // 2xx = accepted; 409 = already synced earlier (idempotency key hit)
      if (res.ok || res.status === 409) {
        await remove(entry.id);
        synced++;
      } else if (res.status >= 400 && res.status < 500) {
        // Rejected by validation — keep it visible so the user can act,
        // but record the error. Never silently drop field data.
        const msg = await res.json().then((j) => j.error).catch(() => res.statusText);
        await tx("readwrite", (s) => s.put({ ...entry, lastError: String(msg) }));
      }
    } catch {
      break; // still offline — stop and retry later
    }
  }
  if (synced > 0) notifyChange();
  return synced;
}

/**
 * Submit now if online, queue if not. All offline-capable forms go through
 * this so behaviour is uniform.
 */
export async function submitOrQueue(params: {
  url: string;
  body: Record<string, unknown>;
  label: string;
  method?: string;
}): Promise<{ queued: boolean; ok: boolean; error?: string }> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const method = params.method ?? "POST";
  const body = { ...params.body, clientUuid: id, submittedAt: createdAt };

  if (navigator.onLine) {
    try {
      const res = await fetch(params.url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return { queued: false, ok: true };
      if (res.status === 409) return { queued: false, ok: true }; // already applied
      if (res.status >= 400 && res.status < 500) {
        const msg = await res.json().then((j) => j.error).catch(() => res.statusText);
        return { queued: false, ok: false, error: String(msg) };
      }
    } catch {
      // fall through to queue
    }
  }

  await enqueue({ id, url: params.url, method, body, label: params.label, createdAt });
  return { queued: true, ok: true };
}
