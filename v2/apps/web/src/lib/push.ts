// Phase 7m: browser-side helpers for Web Push subscribe / unsubscribe.
//
// The tricky bit is going from the server's base64url VAPID key to the
// Uint8Array `PushManager.subscribe()` wants. Everything else is a thin
// wrapper over the standard APIs.

function urlB64ToUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface PushStatus {
  supported: boolean;   // Notification API + service worker + PushManager all present
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
}

async function reg(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.ready;
}

export async function status(): Promise<PushStatus> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { supported: false, permission: "unsupported", subscribed: false };
  }
  const r = await reg();
  const sub = r ? await r.pushManager.getSubscription() : null;
  return { supported: true, permission: Notification.permission, subscribed: !!sub };
}

/** Enable push for this browser. Requests permission if needed, subscribes
 *  via PushManager, and reports the subscription to the backend. Returns
 *  the new status so the caller can update UI in one round-trip. */
export async function enable(): Promise<PushStatus> {
  if (!("Notification" in window)) throw new Error("Push not supported in this browser");
  if (Notification.permission === "denied") throw new Error("Notifications are blocked in browser settings");
  if (Notification.permission === "default") {
    const p = await Notification.requestPermission();
    if (p !== "granted") return status();
  }
  const r = await reg();
  if (!r) throw new Error("Service worker not registered");
  const keyRes = await fetch("/api/me/push/vapid-key", { credentials: "include" });
  const { key, configured } = await keyRes.json();
  if (!configured || !key) throw new Error("Push not configured on server");
  let sub = await r.pushManager.getSubscription();
  if (!sub) {
    sub = await r.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(key) as any,
    });
  }
  const j = sub.toJSON();
  await fetch("/api/me/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
  });
  return status();
}

export async function disable(): Promise<PushStatus> {
  const r = await reg();
  const sub = r ? await r.pushManager.getSubscription() : null;
  if (sub) {
    await fetch("/api/me/push/subscribe", {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => { /* delete-then-unsubscribe stays consistent enough */ });
    await sub.unsubscribe();
  }
  return status();
}

export async function sendTest(): Promise<{ sent: number; failed: number; pruned: number }> {
  const res = await fetch("/api/me/push/test", { method: "POST", credentials: "include" });
  if (!res.ok) throw new Error(`test HTTP ${res.status}`);
  return res.json();
}
