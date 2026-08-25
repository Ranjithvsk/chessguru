// Floating "?" support widget mounted globally by App.tsx. Owner ask
// 2026-08-25: mirror the dreamcy super-admin ticket system for ChessGuru —
// every user on any tenant domain can raise BUG / FEATURE / COMPLAINT /
// CHAT tickets from anywhere in the app. Tickets POST to
// /v2api/api/support/ticket (same-origin) which forwards to the dreamcy
// pos-api endpoint → central platform.support_ticket table → visible in
// the super-admin inbox alongside all other tenant tickets.
//
// Visual + behavioural PARITY with packages/support-widget/SupportWidget.tsx
// (the pos/till/staff widget) — owner ask 2026-08-25 "make ? help and support
// for dreamcy and chessguru same". Same colors, same layout, same silent
// auto-capture on send when no screenshot is attached, same "attach
// screenshot for faster resolution" nudge. Only the auth path differs
// (dreamcy uses JWT from idb-keyval; we use session cookies).
//
// Hidden on /class-v2/* + /call/* (video calls) so it doesn't cover the
// controls.
import { useState, useRef } from "react";
import { useLocation } from "react-router-dom";

const KINDS = [
  { k: "CHAT", label: "💬 Message" },
  { k: "BUG", label: "🐞 Bug" },
  { k: "FEATURE", label: "✨ Feature" },
  { k: "COMPLAINT", label: "⚠️ Complaint" },
] as const;

const MAX_SHOTS = 4;
const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function submitTicket(payload: Record<string, unknown>) {
  const r = await fetch(`${BASE}/api/support/ticket`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!r.ok) throw new Error(body?.message || `Send failed (${r.status})`);
  return body as { ticketNo?: string; id?: string };
}

async function compress(file: Blob): Promise<string | null> {
  try {
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = rej; img.src = url; });
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c.toDataURL("image/jpeg", 0.7);
  } catch { return null; }
}

const CAPTURE_FILTER = (n: HTMLElement) => {
  if (!(n instanceof HTMLElement)) return true;
  if (n.dataset?.supportWidget === "1") return false;
  const tag = n.tagName;
  if (tag === "IFRAME" || tag === "EMBED" || tag === "OBJECT") return false;
  return true;
};

function parseTicketRef(v: string): number | undefined {
  const m = v.trim().match(/(\d+)/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function SupportWidget() {
  const loc = useLocation();
  const hideOnPath = loc.pathname.startsWith("/class-v2/") || loc.pathname.startsWith("/call/");

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("BUG");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [parentRef, setParentRef] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);
  const [ticketNo, setTicketNo] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (hideOnPath) return null;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr("");
    const remaining = MAX_SHOTS - shots.length;
    if (remaining <= 0) { setErr(`Max ${MAX_SHOTS} images per ticket — remove one to add more.`); return; }
    const picks = Array.from(files).slice(0, remaining);
    if (files.length > remaining) setErr(`Only added ${remaining} — max ${MAX_SHOTS}.`);
    const next: string[] = [];
    for (const f of picks) { const d = await compress(f); if (d) next.push(d); }
    setShots((prev) => [...prev, ...next].slice(0, MAX_SHOTS));
    if (fileRef.current) fileRef.current.value = "";
  }

  function onPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const blobs: Blob[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const b = it.getAsFile(); if (b) blobs.push(b);
      }
    }
    if (blobs.length === 0) return;
    e.preventDefault();
    void (async () => {
      const next: string[] = [];
      for (const b of blobs) { const d = await compress(b); if (d) next.push(d); }
      setShots((prev) => [...prev, ...next].slice(0, MAX_SHOTS));
    })();
  }

  async function pasteFromClipboard() {
    setErr("");
    try {
      const nav = navigator as Navigator & { clipboard?: { read?: () => Promise<Array<{ types: string[]; getType: (t: string) => Promise<Blob> }>> } };
      if (!nav.clipboard?.read) { setErr("This browser can't read the clipboard directly — press Ctrl+V in the message box instead."); return; }
      const items = await nav.clipboard.read();
      let any = false;
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith("image/"));
        if (t) {
          const blob = await it.getType(t);
          const d = await compress(blob);
          if (d) { setShots((prev) => [...prev, d].slice(0, MAX_SHOTS)); any = true; }
        }
      }
      if (!any) setErr("No image on the clipboard. Copy an image first (e.g. Win+Shift+S), then click Paste.");
    } catch (e) {
      setErr(`Clipboard blocked — press Ctrl+V in the message box instead.`);
    }
  }

  async function capturePage() {
    if (shots.length >= MAX_SHOTS) { setErr(`Max ${MAX_SHOTS} images per ticket.`); return; }
    setErr(""); setCapturing(true);
    try {
      const { toJpeg } = await import("html-to-image");
      const wasOpen = open;
      setOpen(false);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      try {
        const d = await toJpeg(document.body, {
          quality: 0.7, pixelRatio: 1, backgroundColor: "#ffffff",
          cacheBust: true, skipFonts: true, filter: CAPTURE_FILTER,
        });
        setShots((prev) => [...prev, d].slice(0, MAX_SHOTS));
      } finally { setOpen(wasOpen); }
    } catch (e) {
      setErr(`Could not capture — use 📎 Add image or 📋 Paste instead.`);
    } finally { setCapturing(false); }
  }

  // Silent auto-capture on send when no screenshot attached — hides the
  // widget briefly, snaps, restores. Ensures every ticket has at least one
  // image so the team can see what the user saw without a follow-up ask.
  async function autoCaptureSilent(): Promise<string | null> {
    const hidden: Array<{ el: HTMLElement; prev: string }> = [];
    if (typeof document !== "undefined") {
      document.querySelectorAll<HTMLElement>('[data-support-widget="1"]').forEach((el) => {
        hidden.push({ el, prev: el.style.visibility });
        el.style.visibility = "hidden";
      });
    }
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      const { toJpeg } = await import("html-to-image");
      return await toJpeg(document.body, {
        quality: 0.7, pixelRatio: 1, backgroundColor: "#ffffff",
        cacheBust: true, skipFonts: true, filter: CAPTURE_FILTER,
      });
    } catch { return null; }
    finally { hidden.forEach(({ el, prev }) => { el.style.visibility = prev; }); }
  }

  async function send() {
    if (!message.trim()) { setErr("Please type your message."); return; }
    const parentSeq = parentRef.trim() ? parseTicketRef(parentRef) : undefined;
    if (parentRef.trim() && !parentSeq) { setErr("That ticket number doesn't look right — e.g. TKT-10 or 10."); return; }
    setBusy(true); setErr("");
    try {
      const finalShots = [...shots];
      if (finalShots.length === 0) {
        const auto = await autoCaptureSilent();
        if (auto) finalShots.push(auto);
      }
      const res = await submitTicket({
        kind, message: message.trim(),
        screenshots: finalShots.length ? finalShots : undefined,
        contact: contact.trim() || undefined,
        pageUrl: typeof location !== "undefined" ? location.pathname : undefined,
        parentSeq,
      });
      setTicketNo(res.ticketNo ?? null);
      setDone(true);
      setMessage(""); setShots([]); setContact(""); setParentRef("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send — please try again.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <button
        data-support-widget="1"
        onClick={() => { setOpen(true); setDone(false); setErr(""); }}
        title="Help & feedback"
        aria-label="Help & feedback"
        style={s.fab}
      >?</button>
      {open && (
        <div data-support-widget="1" style={s.backdrop} onClick={() => setOpen(false)}>
          <div style={s.panel} onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div style={{ textAlign: "center", padding: "18px 6px" }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div style={{ fontWeight: 800, fontSize: 18, margin: "6px 0", color: "#0f172a" }}>Thanks — we got it!</div>
                {ticketNo && (
                  <div style={{ margin: "6px auto", display: "inline-block", background: "#f1f5f9", borderRadius: 10, padding: "6px 14px", fontWeight: 800, color: "#230051", letterSpacing: 0.5 }}>
                    Ticket {ticketNo}
                  </div>
                )}
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Save this number for reference — our team will look into it.</div>
                <button onClick={() => setOpen(false)} style={s.send}>Close</button>
              </div>
            ) : (
              <>
                <div style={s.head}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Help &amp; feedback</div>
                  <button onClick={() => setOpen(false)} style={s.x}>✕</button>
                </div>
                <div style={s.kinds}>
                  {KINDS.map((t) => (
                    <button key={t.k} onClick={() => setKind(t.k)} style={{ ...s.kind, ...(kind === t.k ? s.kindOn : {}) }}>{t.label}</button>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onPaste={onPaste}
                  placeholder="Tell us what's happening… (Ctrl+V to paste a screenshot)"
                  rows={4}
                  style={s.ta}
                />
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Your phone / email (optional)"
                  style={s.inp}
                />
                <input
                  value={parentRef}
                  onChange={(e) => setParentRef(e.target.value)}
                  placeholder="Following up on an earlier ticket? e.g. TKT-10 (optional)"
                  style={s.inp}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={() => fileRef.current?.click()} disabled={shots.length >= MAX_SHOTS} style={{ ...s.shot, opacity: shots.length >= MAX_SHOTS ? 0.5 : 1 }}>📎 Add image</button>
                  <button onClick={pasteFromClipboard} disabled={shots.length >= MAX_SHOTS} style={{ ...s.shot, opacity: shots.length >= MAX_SHOTS ? 0.5 : 1 }} title="Paste an image copied to the clipboard">📋 Paste</button>
                  <button onClick={capturePage} disabled={capturing || shots.length >= MAX_SHOTS} style={{ ...s.shot, opacity: capturing || shots.length >= MAX_SHOTS ? 0.5 : 1 }} title="Capture the current page">{capturing ? "📸 Capturing…" : "📸 Capture page"}</button>
                  <span style={{ marginLeft: "auto", color: "#94a3b8", fontSize: 12 }}>{shots.length}/{MAX_SHOTS}</span>
                  <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => onFiles(e.target.files)} style={{ display: "none" }} />
                </div>
                {shots.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {shots.map((src, i) => (
                      <div key={i} style={{ position: "relative" }}>
                        <img src={src} alt={`shot ${i + 1}`} style={{ maxHeight: 80, maxWidth: 120, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                        <button onClick={() => setShots((p) => p.filter((_, j) => j !== i))} title="Remove"
                          style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "none", background: "#0f172a", color: "#fff", fontSize: 12, cursor: "pointer", boxShadow: "0 2px 4px rgba(0,0,0,0.25)" }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Owner ask 2026-08-25: prompt users to attach a screenshot
                    so tickets are actionable without a follow-up round-trip. */}
                <div style={s.nudge}>
                  📎 <b>Please attach a screenshot</b> for faster issue resolving.
                </div>
                {err && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{err}</div>}
                <button onClick={send} disabled={busy} style={{ ...s.send, opacity: busy ? 0.6 : 1 }}>{busy ? "Sending…" : "Send"}</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Styles ported byte-for-byte from packages/support-widget/SupportWidget.tsx
// so the dreamcy pos widget and ChessGuru widget look identical.
const s: Record<string, React.CSSProperties> = {
  fab: { position: "fixed", right: 16, bottom: 16, width: 46, height: 46, borderRadius: "50%", border: "none", cursor: "pointer", zIndex: 9998, background: "rgba(35,0,81,0.55)", color: "#fff", fontSize: 22, fontWeight: 800, backdropFilter: "blur(4px)", boxShadow: "0 8px 24px rgba(2,6,23,0.35)", opacity: 0.55, transition: "opacity .15s, transform .15s" },
  backdrop: { position: "fixed", inset: 0, background: "rgba(2,6,23,0.5)", display: "grid", placeItems: "end", zIndex: 9999, padding: 16 },
  panel: { width: "100%", maxWidth: 380, marginLeft: "auto", background: "#fff", borderRadius: 18, padding: 16, boxShadow: "0 24px 60px rgba(2,6,23,0.4)", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  x: { border: "none", background: "#f1f5f9", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "#475569", fontWeight: 700 },
  kinds: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 },
  kind: { padding: "9px 8px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#334155", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  kindOn: { background: "#230051", color: "#fff", borderColor: "#230051" },
  ta: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit", color: "#0f172a" },
  inp: { width: "100%", boxSizing: "border-box", marginTop: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", fontSize: 14, outline: "none", color: "#0f172a" },
  shot: { padding: "8px 12px", borderRadius: 10, border: "1px dashed #94a3b8", background: "#f8fafc", color: "#334155", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  send: { width: "100%", marginTop: 12, padding: "12px 14px", borderRadius: 12, background: "#008080", color: "#fff", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 800 },
  nudge: { marginTop: 10, padding: "8px 10px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 10, color: "#78350f", fontSize: 12, lineHeight: 1.4 },
};
