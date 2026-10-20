/** Browser-side helpers for phone notifications. Only ever imported by client components. */

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const isIos = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** True when the app was opened from the phone's Home Screen (required for notifications on iPhone). */
export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** The app's service worker, or null if it isn't running (it only runs on the live site, not in development). */
async function registration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await registration(1500);
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

async function save(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 250) }),
  });
  return res.ok;
}

/** Ask permission (must be called from a tap), subscribe this phone, and tell the server. */
export async function enablePush(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pushSupported()) return { ok: false, error: "This browser can't receive notifications." };
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { ok: false, error: "Notifications are blocked for this app — allow them in your phone's settings for Maxey Ops, then try again." };
  if (permission !== "granted") return { ok: false, error: "Permission wasn't given." };
  const reg = await registration();
  if (!reg) return { ok: false, error: "Notifications work on the live site once the app has loaded — reload the page and try again." };
  const keyRes = await fetch("/api/push/key");
  if (!keyRes.ok) return { ok: false, error: "Couldn't reach the server — check your connection and try again." };
  const { publicKey } = (await keyRes.json()) as { publicKey: string };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
    } catch {
      return { ok: false, error: "This phone refused the subscription. Close and reopen the app, then try again." };
    }
  }
  return (await save(sub)) ? { ok: true } : { ok: false, error: "Couldn't save the setting — try again." };
}

/** Turn notifications off on this phone only. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/**
 * If this phone already allowed notifications but isn't subscribed for the person now signed in (for example after
 * signing out and back in), quietly subscribe it again. Never asks for permission.
 */
export async function resubscribeIfAllowed(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await registration(2500);
  if (!reg) return;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await save(existing); // re-assert ownership for whoever is signed in on this phone now
    return;
  }
  const keyRes = await fetch("/api/push/key");
  if (!keyRes.ok) return;
  const { publicKey } = (await keyRes.json()) as { publicKey: string };
  try {
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
    await save(sub);
  } catch {
    /* ignore — the person can turn it on from the Notifications page */
  }
}
