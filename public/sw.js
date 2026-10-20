/* Maxey Ops service worker v3: adds phone notifications (push) on top of v2.
 * v2: offline shell + background outbox sync (Spec §4).
 * v2 fixes the stale-chunk crash: everything is network-first (cache is only
 * an offline fallback), and activation wipes old caches and reloads open tabs
 * so browsers holding the old v1 worker recover automatically. */
const CACHE = "maxey-v2"; // the offline cache name is unchanged so nothing is re-downloaded for the push update

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every old cache (including v1's stale build chunks)
      const keys = await caches.keys();
      const hadOld = keys.some((k) => k !== CACHE);
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      if (hadOld) {
        // Force open tabs to reload once with fresh assets
        const clients = await self.clients.matchAll({ type: "window" });
        clients.forEach((c) => c.navigate(c.url).catch(() => {}));
      }
    })()
  );
});

// Network-first for ALL same-origin GETs. The cache is only used when the
// network is unreachable (offline site visits) — never instead of it, so a
// rebuild can never serve mismatched files again.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // APIs are never cached

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw new Error("offline");
      }
    })()
  );
});

// Background Sync: flush the IndexedDB outbox when connectivity returns,
// even if the tab is closed.
self.addEventListener("sync", (event) => {
  if (event.tag === "outbox-sync") {
    event.waitUntil(flushOutbox());
  }
});

function openOutbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("maxey-outbox", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("outbox")) {
        req.result.createObjectStore("outbox", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function flushOutbox() {
  const db = await openOutbox();
  const entries = await new Promise((resolve, reject) => {
    const t = db.transaction("outbox", "readonly");
    const r = t.objectStore("outbox").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  for (const entry of entries) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.body),
      });
      if (res.ok || res.status === 409) {
        await new Promise((resolve, reject) => {
          const t = db.transaction("outbox", "readwrite");
          const r = t.objectStore("outbox").delete(entry.id);
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        });
        const clients = await self.clients.matchAll();
        clients.forEach((c) => c.postMessage({ type: "outbox-synced" }));
      }
    } catch {
      break; // still offline
    }
  }
}

// ---- Phone notifications (Web Push) ----
// The server sends a small JSON message { title, body, url, tag }. It never carries amounts or other sensitive detail —
// only that something needs attention; the app itself decides who may see the details when it is opened.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Maxey Ops", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Maxey Ops";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Tap to open",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined, // a newer notification about the same record replaces the older one
      renotify: !!data.tag,
      data: { url: data.url || "/dashboard" },
    })
  );
});

// Tapping a notification opens (or focuses) the app on the page it is about.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/dashboard", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          if ("navigate" in w) await w.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
