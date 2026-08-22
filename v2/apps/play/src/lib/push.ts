// Subscribe the browser to web-push using our VAPID key. One button-click flow.
// Returns { ok: true } if subscribed (or already-subscribed), { ok: false, reason } otherwise.
export async function subscribeToPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "Push notifications aren't supported in this browser." };
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "Permission denied." };
  const reg = await navigator.serviceWorker.ready;
  // Fetch the VAPID public key from our API
  const keyRes = await fetch("/v2api/api/play/push/key").then((r) => r.json()).catch(() => null);
  if (!keyRes?.key) return { ok: false, reason: "Push isn't configured on the server yet." };
  // Convert base64url → Uint8Array for applicationServerKey.
  const raw = keyRes.key.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (raw.length % 4)) % 4);
  const bin = atob(raw + pad);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: arr });
  const j = sub.toJSON();
  const save = await fetch("/v2api/api/play/push/subscribe", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
  }).then((r) => r.json()).catch(() => null);
  if (!save?.ok) return { ok: false, reason: save?.error || "Save failed" };
  return { ok: true };
}
