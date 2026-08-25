// Floating "?" support widget mounted globally by App.tsx. Owner ask
// 2026-08-25: mirror the dreamcy super-admin ticket system for ChessGuru —
// every user on any tenant domain can raise BUG / FEATURE / COMPLAINT /
// CHAT tickets from anywhere in the app. Tickets POST to
// /v2api/api/support/ticket (same-origin) which forwards to the dreamcy
// pos-api endpoint → central platform.support_ticket table → visible in
// the super-admin inbox alongside all other tenant tickets.
//
// Hidden on /class-v2/* (video calls) — the floating button would cover
// the video controls.
import { useState, useRef, useEffect } from "react";
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
  if (!r.ok) {
    const msg = body?.message || `Send failed (${r.status})`;
    throw new Error(msg);
  }
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

export default function SupportWidget() {
  const loc = useLocation();
  const hideOnPath = loc.pathname.startsWith("/class-v2/") || loc.pathname.startsWith("/call/");

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("BUG");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ticketNo, setTicketNo] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset form when re-opening.
  useEffect(() => {
    if (!open) return;
    setDone(false); setTicketNo(null); setErr("");
  }, [open]);

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

  async function capturePage() {
    if (shots.length >= MAX_SHOTS) { setErr(`Max ${MAX_SHOTS} images per ticket.`); return; }
    setErr("");
    try {
      // Dynamic import so we don't bloat the main bundle for users who
      // never open the widget.
      const { toJpeg } = await import("html-to-image");
      const wasOpen = open;
      setOpen(false);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      try {
        const d = await toJpeg(document.body, {
          quality: 0.7, pixelRatio: 1, backgroundColor: "#ffffff",
          cacheBust: true, skipFonts: true,
          filter: (n) => (n instanceof HTMLElement ? n.dataset?.supportWidget !== "1" : true),
        });
        setShots((prev) => [...prev, d].slice(0, MAX_SHOTS));
      } finally { setOpen(wasOpen); }
    } catch (e) {
      setErr(`Could not capture — ${(e as Error).message}. Use 📎 Add image instead.`);
    }
  }

  async function submit() {
    setErr("");
    if (!message.trim()) { setErr("Please describe the issue or feedback."); return; }
    setBusy(true);
    try {
      const res = await submitTicket({
        kind,
        message: message.trim(),
        contact: contact.trim() || undefined,
        screenshots: shots.length ? shots : undefined,
        pageUrl: location.href,
      });
      setTicketNo(res.ticketNo ?? null);
      setDone(true);
      setMessage(""); setShots([]); setContact("");
    } catch (e) {
      setErr((e as Error).message || "Send failed — please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div data-support-widget="1" style={{ position: "fixed", right: 16, bottom: 16, zIndex: 40 }}>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Help & feedback"
          className="grid h-11 w-11 place-items-center rounded-full border border-brand-400/60 bg-ink-900/95 text-lg font-bold text-brand-200 shadow-xl backdrop-blur transition hover:bg-ink-800 hover:text-white"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,.35)" }}
        >?</button>
      )}
      {open && (
        <div className="w-[320px] max-w-[calc(100vw-32px)] rounded-2xl border border-ink-700 bg-ink-900/98 p-3 text-white shadow-2xl backdrop-blur"
             style={{ boxShadow: "0 12px 32px rgba(0,0,0,.45)" }}>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Help & feedback</div>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-white" title="Close">✕</button>
          </div>
          {done ? (
            <div className="py-3 text-center">
              <div className="text-2xl">✅</div>
              <div className="mt-1 text-sm font-semibold">Sent — thank you!</div>
              {ticketNo && (
                <div className="mt-1 text-[11px] text-ink-400">Reference: {ticketNo}</div>
              )}
              <button
                onClick={() => setOpen(false)}
                className="mt-3 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400"
              >Done</button>
            </div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {KINDS.map((k) => (
                  <button
                    key={k.k}
                    onClick={() => setKind(k.k)}
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      kind === k.k
                        ? "bg-brand-500 text-white"
                        : "bg-ink-800 text-ink-200 hover:bg-ink-700"
                    }`}
                  >{k.label}</button>
                ))}
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={onPaste}
                placeholder={
                  kind === "BUG" ? "What went wrong? What did you expect?" :
                  kind === "FEATURE" ? "What would help you?" :
                  kind === "COMPLAINT" ? "What's frustrating you?" :
                  "Ask us anything…"
                }
                rows={4}
                className="w-full resize-none rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-2 text-xs text-white placeholder-ink-500 focus:border-brand-500 focus:outline-none"
                maxLength={5000}
              />
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Contact (email / phone) — optional"
                className="mt-2 w-full rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-xs text-white placeholder-ink-500 focus:border-brand-500 focus:outline-none"
                maxLength={200}
              />
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={shots.length >= MAX_SHOTS}
                  className="rounded-md border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] font-semibold text-ink-200 hover:bg-ink-700 disabled:opacity-40"
                >📎 Add image</button>
                <button
                  type="button"
                  onClick={capturePage}
                  disabled={shots.length >= MAX_SHOTS}
                  className="rounded-md border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] font-semibold text-ink-200 hover:bg-ink-700 disabled:opacity-40"
                >📸 Capture page</button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => onFiles(e.target.files)}
                  className="hidden"
                />
                <span className="ml-auto text-[10px] text-ink-500">{shots.length}/{MAX_SHOTS}</span>
              </div>
              {shots.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {shots.map((s, i) => (
                    <div key={i} className="relative">
                      <img src={s} alt="" className="h-12 w-12 rounded object-cover ring-1 ring-ink-700" />
                      <button
                        type="button"
                        onClick={() => setShots((p) => p.filter((_, j) => j !== i))}
                        className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-[9px] font-bold text-white hover:bg-rose-400"
                        title="Remove"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              {err && (
                <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-200">{err}</div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={submit}
                  disabled={busy || !message.trim()}
                  className="flex-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
                >{busy ? "Sending…" : "Send"}</button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800"
                >Cancel</button>
              </div>
              <div className="mt-2 text-center text-[9px] text-ink-500">
                Goes to the ChessGuru team. We may reply to your contact.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
