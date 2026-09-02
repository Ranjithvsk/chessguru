// Floating "?" support widget mounted globally by App.tsx. Owner ask
// 2026-08-25: mirror the dreamcy super-admin ticket system for ChessGuru —
// every user on any tenant domain can raise BUG / FEATURE / COMPLAINT /
// CHAT tickets from anywhere in the app. Tickets POST to
// /v2api/api/support/ticket (same-origin) which forwards to the dreamcy
// pos-api endpoint → central platform.support_ticket table → visible in
// the super-admin inbox alongside all other tenant tickets.
//
// TKT-90 chat loop (2026-08-27): added a "Your tickets" tab so users can
// see admin replies, reply back, and reopen resolved tickets — closing
// the round-trip so the widget isn't fire-and-forget anymore. Also
// shows a red dot on the ? button when there's an unread admin reply.
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
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const KINDS = [
  { k: "CHAT", label: "💬 Message" },
  { k: "BUG", label: "🐞 Bug" },
  { k: "FEATURE", label: "✨ Feature" },
  { k: "COMPLAINT", label: "⚠️ Complaint" },
] as const;

const MAX_SHOTS = 4;
const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
const LAST_SEEN_KEY = "cg.support.lastSeenAt";

type Reply = {
  id: string;
  ticketNo: string;
  kind: string;
  message: string;
  screenshots: string[];
  isAdminReply: boolean;
  createdAt: string;
  status?: string;
};

type MyTicket = {
  id: string;
  ticketNo: string;
  seq: number;
  app: string | null;
  userId: string | null;
  userName: string | null;
  kind: string;
  message: string;
  screenshots: string[];
  pageUrl: string | null;
  contact: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  replies: Reply[];
};

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
    // Map HTTP status → human message. Server sometimes returns bare 400
    // (body-parser rejections come back with no JSON message, so
    // body?.message is undefined — the previous fallback of "Send failed
    // (400)" told the user nothing about the actual cause). Owner report
    // 2026-09-02: "why did it show 400 instead of the actual error?".
    if (body?.message) throw new Error(body.message);
    if (r.status === 400 || r.status === 413) {
      throw new Error("Your ticket is too large — remove or shrink attached screenshots and try again.");
    }
    if (r.status === 401) throw new Error("Your session has ended — sign in again and retry.");
    if (r.status === 502 || r.status === 503 || r.status === 504) {
      throw new Error("Support server is temporarily unreachable — try again in a minute.");
    }
    if (r.status >= 500) throw new Error("Support server hit an error — please try again. If it keeps happening, contact us directly.");
    throw new Error(`Send failed (HTTP ${r.status}). Try again in a minute.`);
  }
  return body as { ticketNo?: string; id?: string };
}

async function fetchMyTickets(): Promise<MyTicket[]> {
  const r = await fetch(`${BASE}/api/support/my-tickets`, { credentials: "include" });
  if (!r.ok) throw new Error(`Load failed (${r.status})`);
  const j = await r.json().catch(() => null);
  return Array.isArray(j?.tickets) ? j.tickets : [];
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

function newestAdminReplyAt(tickets: MyTicket[]): number {
  let max = 0;
  for (const t of tickets) {
    for (const r of t.replies) {
      if (!r.isAdminReply) continue;
      const ts = new Date(r.createdAt).getTime();
      if (ts > max) max = ts;
    }
  }
  return max;
}

function readLastSeen(): number {
  try { return Number(localStorage.getItem(LAST_SEEN_KEY) || 0); } catch { return 0; }
}
function writeLastSeen(v: number): void {
  try { localStorage.setItem(LAST_SEEN_KEY, String(v)); } catch { /* ignore */ }
}
function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
    if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch { return ""; }
}
function statusChip(status: string): { label: string; bg: string; fg: string } {
  switch (status) {
    case "RESOLVED": return { label: "resolved", bg: "#dcfce7", fg: "#166534" };
    case "IN_PROGRESS": return { label: "in progress", bg: "#e0e7ff", fg: "#3730a3" };
    case "CLOSED": return { label: "closed", bg: "#e2e8f0", fg: "#475569" };
    default: return { label: "open", bg: "#fef3c7", fg: "#78350f" };
  }
}

export default function SupportWidget() {
  const loc = useLocation();
  const hideOnPath = loc.pathname.startsWith("/class-v2/") || loc.pathname.startsWith("/call/");

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"new" | "inbox">("new");
  const [kind, setKind] = useState<string>("BUG");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [parentRef, setParentRef] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);
  const [ticketNo, setTicketNo] = useState<string | null>(null);
  const [wasFollowUp, setWasFollowUp] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // "Your tickets" state
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsErr, setTicketsErr] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replyBusy, setReplyBusy] = useState<Record<number, boolean>>({});
  const [hasUnread, setHasUnread] = useState(false);

  const loadTickets = useCallback(async (): Promise<MyTicket[]> => {
    setTicketsLoading(true); setTicketsErr("");
    try {
      const list = await fetchMyTickets();
      setTickets(list);
      const newest = newestAdminReplyAt(list);
      const unread = newest > readLastSeen();
      setHasUnread(unread);
      return list;
    } catch (e) {
      setTicketsErr(e instanceof Error ? e.message : "Couldn't load your tickets.");
      return [];
    } finally { setTicketsLoading(false); }
  }, []);

  // Background load on mount so the badge is accurate before the user opens the widget.
  useEffect(() => { void loadTickets(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // When the user opens the Inbox tab, mark all admin replies as seen.
  useEffect(() => {
    if (open && tab === "inbox" && tickets.length) {
      const newest = newestAdminReplyAt(tickets);
      if (newest > 0) { writeLastSeen(newest); setHasUnread(false); }
    }
  }, [open, tab, tickets]);

  // 2026-08-27 mobile keyboard fix: on Android/iOS the on-screen keyboard was
  // covering the reply textarea because the panel is anchored bottom via
  // `place-items:end`. Listen to visualViewport and shrink the modal's
  // effective height to sit above the keyboard, then delegate to
  // scrollIntoView so the focused textarea stays visible.
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const recompute = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbInset(inset);
    };
    vv.addEventListener("resize", recompute);
    vv.addEventListener("scroll", recompute);
    recompute();
    return () => { vv.removeEventListener("resize", recompute); vv.removeEventListener("scroll", recompute); };
  }, []);

  // Any textarea inside the widget: on focus, wait for the keyboard animation
  // and then scroll the field into view. Belt-and-braces with the kbInset
  // above — visualViewport handles most modern browsers but iOS Safari
  // sometimes reports late, so scrollIntoView is the safety net.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
    if (!root) return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")) return;
      // 300ms covers the keyboard slide-in on iOS/Android.
      setTimeout(() => { el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 300);
    };
    root.addEventListener("focusin", onFocus);
    return () => { root.removeEventListener("focusin", onFocus); };
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
      // Owner ask 2026-08-27: a follow-up should confirm under the SAME
      // ticket number the user typed, not a fresh child-row seq. The child
      // seq is a DB detail — the user only knows their thread as TKT-<parent>.
      setTicketNo(parentSeq ? `TKT-${parentSeq}` : (res.ticketNo ?? null));
      setWasFollowUp(!!parentSeq);
      setDone(true);
      setMessage(""); setShots([]); setContact(""); setParentRef("");
      // Refresh the inbox in the background so the new ticket appears in "Your tickets".
      void loadTickets();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send — please try again.");
    } finally { setBusy(false); }
  }

  async function replyTo(seq: number, ticketStatus: string) {
    const draft = (replyDrafts[seq] ?? "").trim();
    if (!draft) return;
    setReplyBusy((x) => ({ ...x, [seq]: true }));
    setTicketsErr("");
    try {
      // parentSeq on the server auto-reopens RESOLVED tickets to IN_PROGRESS.
      // We still show the "will reopen" hint in the UI when status === RESOLVED.
      await submitTicket({ kind: "CHAT", message: draft, parentSeq: seq });
      setReplyDrafts((x) => ({ ...x, [seq]: "" }));
      // Reload so the new reply + reopened status show up.
      await loadTickets();
      void ticketStatus; // status only used for UI hint (no-op here)
    } catch (e) {
      setTicketsErr(e instanceof Error ? e.message : "Couldn't send reply.");
    } finally { setReplyBusy((x) => ({ ...x, [seq]: false })); }
  }

  return (
    <>
      <button
        data-support-widget="1"
        onClick={() => { setOpen(true); setDone(false); setErr(""); }}
        title="Help & feedback"
        aria-label="Help & feedback"
        style={s.fab}
      >
        ?
        {hasUnread && <span style={s.dot} aria-label="unread reply" />}
      </button>
      {open && (
        <div
          data-support-widget="1"
          style={{ ...s.backdrop, paddingBottom: 16 + kbInset }}
          onClick={() => setOpen(false)}
        >
          <div
            ref={panelRef}
            style={{ ...s.panel, maxHeight: `calc(100vh - ${32 + kbInset}px)`, overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {done ? (
              <div style={{ textAlign: "center", padding: "18px 6px" }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div style={{ fontWeight: 800, fontSize: 18, margin: "6px 0", color: "#0f172a" }}>
                  {wasFollowUp ? "Reply added" : "Thanks — we got it!"}
                </div>
                {ticketNo && (
                  <div style={{ margin: "6px auto", display: "inline-block", background: "#f1f5f9", borderRadius: 10, padding: "6px 14px", fontWeight: 800, color: "#230051", letterSpacing: 0.5 }}>
                    {wasFollowUp ? "Reply on " : "Ticket "}{ticketNo}
                  </div>
                )}
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>You'll see the reply here under "Your tickets" — no need to check email.</div>
                <button onClick={() => { setDone(false); setTab("inbox"); void loadTickets(); }} style={{ ...s.send, background: "#0f172a" }}>Open your tickets</button>
                <button onClick={() => setOpen(false)} style={{ ...s.send, marginTop: 8 }}>Close</button>
              </div>
            ) : (
              <>
                <div style={s.head}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Help &amp; feedback</div>
                  <button onClick={() => setOpen(false)} style={s.x}>✕</button>
                </div>
                <div style={s.tabs}>
                  <button
                    onClick={() => setTab("new")}
                    style={{ ...s.tab, ...(tab === "new" ? s.tabOn : {}) }}
                  >New ticket</button>
                  <button
                    onClick={() => { setTab("inbox"); void loadTickets(); }}
                    style={{ ...s.tab, ...(tab === "inbox" ? s.tabOn : {}) }}
                  >
                    Your tickets{hasUnread && <span style={s.tabDot} />}
                  </button>
                </div>
                {tab === "new" ? (
                  <>
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
                ) : (
                  // No inner maxHeight — the outer panel is the scroll container
                  // (its height already tracks visualViewport so the keyboard
                  // doesn't cover the reply textarea on mobile).
                  <div style={{ marginTop: 4 }}>
                    {ticketsLoading && <div style={{ color: "#64748b", fontSize: 13, padding: "10px 0" }}>Loading your tickets…</div>}
                    {ticketsErr && <div style={{ color: "#dc2626", fontSize: 13, padding: "10px 0" }}>{ticketsErr}</div>}
                    {!ticketsLoading && !ticketsErr && tickets.length === 0 && (
                      <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                        You haven't filed any tickets yet.<br/>Use <b>New ticket</b> to start one.
                      </div>
                    )}
                    {tickets.map((t) => {
                      const chip = statusChip(t.status);
                      const draft = replyDrafts[t.seq] ?? "";
                      const isReopening = t.status === "RESOLVED";
                      return (
                        <div key={t.id} style={s.thread}>
                          <div style={s.threadHead}>
                            <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>{t.ticketNo}</div>
                            <div style={{ ...s.chip, background: chip.bg, color: chip.fg }}>{chip.label}</div>
                            <div style={{ marginLeft: "auto", color: "#94a3b8", fontSize: 12 }}>{fmtWhen(t.createdAt)}</div>
                          </div>
                          <div style={{ ...s.msg, color: "#0f172a" }}>{t.message}</div>
                          {t.screenshots.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                              {t.screenshots.slice(0, 4).map((src, i) => (
                                <a key={i} href={src} target="_blank" rel="noreferrer">
                                  <img src={src} alt="" style={{ maxHeight: 60, maxWidth: 90, borderRadius: 6, border: "1px solid #e2e8f0" }} />
                                </a>
                              ))}
                            </div>
                          )}
                          {t.replies.map((r) => (
                            <div key={r.id} style={{ ...s.reply, ...(r.isAdminReply ? s.replyAdmin : s.replyUser) }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: r.isAdminReply ? "#166534" : "#334155", marginBottom: 2 }}>
                                {r.isAdminReply ? "Support team" : "You"} · <span style={{ color: "#94a3b8", fontWeight: 400 }}>{fmtWhen(r.createdAt)}</span>
                              </div>
                              <div style={{ color: "#0f172a", whiteSpace: "pre-wrap", fontSize: 13 }}>{r.message}</div>
                              {r.screenshots.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                                  {r.screenshots.slice(0, 4).map((src, i) => (
                                    <a key={i} href={src} target="_blank" rel="noreferrer">
                                      <img src={src} alt="" style={{ maxHeight: 50, maxWidth: 80, borderRadius: 6, border: "1px solid #e2e8f0" }} />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          <div style={s.replyBox}>
                            <textarea
                              value={draft}
                              onChange={(e) => setReplyDrafts((x) => ({ ...x, [t.seq]: e.target.value }))}
                              placeholder={isReopening ? "Reply — this will reopen the ticket…" : "Reply…"}
                              rows={2}
                              style={{ ...s.ta, marginBottom: 0, borderColor: isReopening ? "#f59e0b" : "#cbd5e1" }}
                            />
                            {isReopening && (
                              <div style={{ color: "#78350f", fontSize: 11, marginTop: 4 }}>
                                💡 Sending a reply on a resolved ticket will reopen it.
                              </div>
                            )}
                            <button
                              onClick={() => replyTo(t.seq, t.status)}
                              disabled={!draft.trim() || replyBusy[t.seq]}
                              style={{ ...s.send, marginTop: 8, opacity: !draft.trim() || replyBusy[t.seq] ? 0.5 : 1, background: isReopening ? "#f59e0b" : "#008080" }}
                            >
                              {replyBusy[t.seq] ? "Sending…" : (isReopening ? "Reopen & reply" : "Send reply")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
  dot: { position: "absolute", top: 6, right: 6, width: 10, height: 10, borderRadius: "50%", background: "#ef4444", border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(2,6,23,0.15)" },
  backdrop: { position: "fixed", inset: 0, background: "rgba(2,6,23,0.5)", display: "grid", placeItems: "end", zIndex: 9999, padding: 16 },
  panel: { width: "100%", maxWidth: 380, marginLeft: "auto", background: "#fff", borderRadius: 18, padding: 16, boxShadow: "0 24px 60px rgba(2,6,23,0.4)", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  x: { border: "none", background: "#f1f5f9", borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: "#475569", fontWeight: 700 },
  tabs: { display: "grid", gridTemplateColumns: "1fr 1fr", background: "#f1f5f9", padding: 3, borderRadius: 10, marginBottom: 10 },
  tab: { padding: "8px 4px", borderRadius: 8, border: "none", background: "transparent", color: "#475569", cursor: "pointer", fontSize: 13, fontWeight: 700, position: "relative" },
  tabOn: { background: "#fff", color: "#230051", boxShadow: "0 1px 3px rgba(2,6,23,0.1)" },
  tabDot: { position: "absolute", top: 4, right: 8, width: 8, height: 8, borderRadius: "50%", background: "#ef4444" },
  kinds: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 },
  kind: { padding: "9px 8px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#334155", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  kindOn: { background: "#230051", color: "#fff", borderColor: "#230051" },
  ta: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit", color: "#0f172a" },
  inp: { width: "100%", boxSizing: "border-box", marginTop: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", fontSize: 14, outline: "none", color: "#0f172a" },
  shot: { padding: "8px 12px", borderRadius: 10, border: "1px dashed #94a3b8", background: "#f8fafc", color: "#334155", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  send: { width: "100%", marginTop: 12, padding: "12px 14px", borderRadius: 12, background: "#008080", color: "#fff", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 800 },
  nudge: { marginTop: 10, padding: "8px 10px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 10, color: "#78350f", fontSize: 12, lineHeight: 1.4 },
  thread: { border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, marginBottom: 10, background: "#fff" },
  threadHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  chip: { padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 },
  msg: { fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap", padding: "6px 8px", background: "#f8fafc", borderRadius: 8, borderLeft: "3px solid #cbd5e1" },
  reply: { padding: "8px 10px", borderRadius: 8, marginTop: 6 },
  replyAdmin: { background: "#dcfce7", borderLeft: "3px solid #166534" },
  replyUser: { background: "#eef2ff", borderLeft: "3px solid #6366f1" },
  replyBox: { marginTop: 10, paddingTop: 10, borderTop: "1px dashed #e2e8f0" },
};
