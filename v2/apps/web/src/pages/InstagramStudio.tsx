// chessguru.cc/instagram — a private studio that turns things that actually
// happened in ChessGuru into square images ready to post.
//
// Gated by the email-code sign-in the app already has (/auth/request-otp +
// /auth/otp-signin), then narrowed to one address server-side. The check here
// only decides which screen to draw; the API re-checks every request, so a
// forged client state gets an empty page and nothing else.
//
// The board is drawn on a canvas rather than screenshotted from the DOM, so the
// export is a true 1080x1080 at whatever pixel density Instagram wants, and it
// works with no network once the page has loaded.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { post, get, deleteJson, API_BASE } from "../lib/api";
import { CBURNETT_PIECES } from "../components/cburnett-pieces";

interface PostCard {
  id: string;
  kind: "moment" | "climb" | "puzzle" | "leaderboard";
  title: string;
  subtitle: string;
  fen: string | null;
  orientation: "white" | "black";
  highlight: string | null;
  caption: string;
  hashtags: string[];
  sourceUrl: string | null;
  at: string | null;
}

const SIZE = 1080;

interface MediaItem { id: string; url: string; kind: "image" | "video"; bytes: number; at: string; backedUp: boolean }
/** One row per file being sent. `sent`/`total` are bytes, so the bar is real
 *  progress from the browser rather than a spinner pretending to be one. */
interface Upload { name: string; sent: number; total: number; state: "sending" | "finishing" | "done" | "error"; error?: string }
const LOGO_KEY = "cg-ig-logo";   // which library image to stamp on exports
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const KIND_LABEL: Record<PostCard["kind"], string> = {
  moment: "Student moment", climb: "Progress", puzzle: "Puzzle", leaderboard: "Leaderboard",
};

/* ── board drawing ─────────────────────────────────────────────────────── */

const imgCache = new Map<string, HTMLImageElement>();
function pieceImage(ch: string): Promise<HTMLImageElement | null> {
  const src = CBURNETT_PIECES[ch];
  if (!src) return Promise.resolve(null);
  const hit = imgCache.get(ch);
  if (hit?.complete) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => { imgCache.set(ch, im); resolve(im); };
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/** FEN board field → 64 squares, index 0 = a8. */
function fenSquares(fen: string): (string | null)[] {
  const out: (string | null)[] = [];
  for (const rank of String(fen).split(" ")[0]!.split("/")) {
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") { for (let i = 0; i < Number(ch); i++) out.push(null); }
      else out.push(ch);
    }
  }
  while (out.length < 64) out.push(null);
  return out.slice(0, 64);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** A library image stamped bottom-left, so an exported post carries the real
 *  brand instead of a text footer. Loaded through the same cache as the pieces. */
async function logoImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  const hit = imgCache.get(url);
  if (hit?.complete) return hit;
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";   // same origin in production; keeps toBlob() untainted either way
    im.onload = () => { imgCache.set(url, im); resolve(im); };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

async function drawCard(canvas: HTMLCanvasElement, card: PostCard, title: string, subtitle: string, logoUrl: string | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = SIZE; canvas.height = SIZE;

  // Ground. Deep slate with a warm rim so the square reads as a designed tile
  // in a feed rather than a screenshot on black.
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, "#131a24"); bg.addColorStop(1, "#0b0f16");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = "rgba(45,212,191,0.28)"; ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, SIZE - 6, SIZE - 6);

  const hasBoard = !!card.fen;
  const boardPx = 660, bx = (SIZE - boardPx) / 2, by = hasBoard ? 250 : 0;

  if (hasBoard) {
    const squares = fenSquares(card.fen!);
    const flip = card.orientation === "black";
    const cell = boardPx / 8;
    for (let i = 0; i < 64; i++) {
      const idx = flip ? 63 - i : i;
      const file = i % 8, rank = Math.floor(i / 8);
      const light = (file + rank) % 2 === 0;
      ctx.fillStyle = light ? "#eef0f4" : "#6f8aa6";
      ctx.fillRect(bx + file * cell, by + rank * cell, cell, cell);
      void idx;
    }
    // Highlight the destination square, if the card names one.
    if (card.highlight && /^[a-h][1-8]$/.test(card.highlight)) {
      const f = card.highlight.charCodeAt(0) - 97;
      const r = 8 - Number(card.highlight[1]);
      const ff = flip ? 7 - f : f, rr = flip ? 7 - r : r;
      ctx.fillStyle = "rgba(45,212,191,0.55)";
      ctx.fillRect(bx + ff * cell, by + rr * cell, cell, cell);
    }
    const imgs = await Promise.all(squares.map((ch) => (ch ? pieceImage(ch) : Promise.resolve(null))));
    for (let i = 0; i < 64; i++) {
      const at = flip ? 63 - i : i;
      const im = imgs[at];
      if (!im) continue;
      const file = i % 8, rank = Math.floor(i / 8);
      ctx.drawImage(im, bx + file * cell, by + rank * cell, cell, cell);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, boardPx, boardPx);
  }

  // Headline above the board (or centred when there is no board).
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 62px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
  const titleY = hasBoard ? 150 : SIZE / 2 - 40;
  const titleLines = wrap(ctx, title, SIZE - 140).slice(0, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, SIZE / 2, titleY + i * 70));

  ctx.fillStyle = "#5eead4";
  ctx.font = "500 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
  const subY = hasBoard ? 150 + titleLines.length * 70 + 8 : SIZE / 2 + 40;
  wrap(ctx, subtitle, SIZE - 180).slice(0, 2).forEach((l, i) => ctx.fillText(l, SIZE / 2, subY + i * 44));

  // Footer mark — the logo when one is chosen, the wordmark otherwise.
  const logo = await logoImage(logoUrl);
  if (logo) {
    const h = 132, w = (logo.width / Math.max(1, logo.height)) * h;
    ctx.drawImage(logo, 54, SIZE - h - 42, w, h);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "600 28px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("chessguru.cc", SIZE - 54, SIZE - 58);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "600 30px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("chessguru.cc", SIZE / 2, SIZE - 58);
  }
}

/* ── sign in ───────────────────────────────────────────────────────────── */

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) { setMsg("Enter the email address."); return; }
    setBusy(true); setMsg(null);
    try {
      await post("/auth/request-otp", { email: email.trim().toLowerCase() });
      // Always the same answer, whether or not the address is known — the API
      // deliberately does not say, so the page must not either.
      setStage("code");
      setMsg("If that address has an account, a 6-digit code is on its way. It lasts 10 minutes.");
    } catch { setMsg("Could not send the code. Try again."); }
    finally { setBusy(false); }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await post<{ ok: boolean; error?: string }>("/auth/otp-signin", { email: email.trim().toLowerCase(), code: code.trim() });
      if (r.ok) onDone(); else setMsg(r.error || "That code is invalid or has expired.");
    } catch { setMsg("That code is invalid or has expired."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900/60 p-6">
        <h1 className="font-display text-2xl text-white">Instagram Studio</h1>
        <p className="mt-1 text-sm text-ink-400">Private. Sign in with the owner email to continue.</p>
        {stage === "email" ? (
          <form onSubmit={sendCode} className="mt-5 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink-400" htmlFor="ig-email">Email</label>
            <input id="ig-email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-teal-400"
              placeholder="you@gmail.com" />
            <button type="submit" disabled={busy}
              className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Sending…" : "Send me a code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-5 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink-400" htmlFor="ig-code">6-digit code</label>
            <input id="ig-code" name="one-time-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-center font-mono text-xl tracking-[0.4em] text-white outline-none focus:border-teal-400"
              placeholder="000000" />
            <button type="submit" disabled={busy || code.length !== 6}
              className="w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button type="button" onClick={() => { setStage("email"); setCode(""); setMsg(null); }}
              className="w-full text-xs text-ink-400 hover:text-ink-200">Use a different address</button>
          </form>
        )}
        {msg && <p className="mt-3 text-xs text-ink-300">{msg}</p>}
      </div>
    </div>
  );
}

/* ── studio ────────────────────────────────────────────────────────────── */

export default function InstagramStudio() {
  const [me, setMe] = useState<{ ok: boolean; email: string | null } | null>(null);
  const [cards, setCards] = useState<PostCard[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(() => { try { return localStorage.getItem(LOGO_KEY); } catch { return null; } });
  const [uploads, setUploads] = useState<Upload[]>([]);
  const uploading = uploads.some((u) => u.state === "sending" || u.state === "finishing");
  const [mediaMsg, setMediaMsg] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refreshMe = useCallback(() => {
    get<{ ok: boolean; email: string | null }>("/api/instagram/whoami")
      .then(setMe).catch(() => setMe({ ok: false, email: null }));
  }, []);
  useEffect(refreshMe, [refreshMe]);

  useEffect(() => {
    if (!me?.ok) return;
    get<{ ok: boolean; cards: PostCard[] }>("/api/instagram/sources")
      .then((r) => { setCards(r.cards || []); if (r.cards?.length) setSel(r.cards[0]!.id); })
      .catch(() => setCards([]));
  }, [me?.ok]);

  const loadMedia = useCallback(() => {
    get<{ ok: boolean; items: MediaItem[] }>("/api/instagram/media")
      .then((r) => setMedia(r.items || [])).catch(() => setMedia([]));
  }, []);
  useEffect(() => { if (me?.ok) loadMedia(); }, [me?.ok, loadMedia]);

  const card = useMemo(() => cards?.find((c) => c.id === sel) ?? null, [cards, sel]);

  // Card chosen → seed the editable fields from it.
  useEffect(() => {
    if (!card) return;
    setTitle(card.title); setSubtitle(card.subtitle);
    setCaption(`${card.caption}\n\n${card.hashtags.map((h) => `#${h}`).join(" ")}`);
  }, [card]);

  // Any edit redraws the canvas.
  useEffect(() => {
    if (!card || !canvasRef.current) return;
    void drawCard(canvasRef.current, card, title, subtitle, logoUrl);
  }, [card, title, subtitle, logoUrl]);

  const download = () => {
    const c = canvasRef.current;
    if (!c || !card) return;
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chessguru-${card.id.replace(/[^a-z0-9]+/gi, "-")}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  };

  /** XHR rather than fetch: fetch cannot report upload progress, and a 200 MB
   *  video with no feedback is indistinguishable from a hung page. The bar
   *  tracks bytes actually on the wire; once they are all sent the row switches
   *  to "saving", because the server is still pushing the file to B2 and that
   *  wait is real. */
  const sendOne = (f: File, idx: number) => new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const xhr = new XMLHttpRequest();
    // API_BASE, not a bare "/api/…": production serves the API under /v2api and
    // a bare path reaches nginx's SPA fallback, which answers 200 with
    // index.html. That is how push subscribe silently failed for every user
    // until 2026-09-18 — the same trap, and it looks like success.
    xhr.open("POST", `${API_BASE}/api/instagram/media/${encodeURIComponent(f.name)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", f.type || "application/octet-stream");
    const patch = (u: Partial<Upload>) => setUploads((prev) => prev.map((row, i) => (i === idx ? { ...row, ...u } : row)));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch({ sent: e.loaded, total: e.total }); };
    // Bytes are all on the wire; the server is only writing the file now. The
    // copy to Backblaze happens after the response, so this is brief — it used
    // to sit here for the whole B2 push, which looked like a hang.
    xhr.upload.onload = () => patch({ sent: f.size, state: "finishing" });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { patch({ state: "done", sent: f.size }); resolve({ ok: true }); return; }
      let msg = `HTTP ${xhr.status}`;
      try { msg = JSON.parse(xhr.responseText)?.message || msg; } catch { /* keep the status */ }
      patch({ state: "error", error: msg }); resolve({ ok: false, error: msg });
    };
    xhr.onerror = () => { patch({ state: "error", error: "network error" }); resolve({ ok: false, error: "network error" }); };
    xhr.onabort = () => { patch({ state: "error", error: "cancelled" }); resolve({ ok: false, error: "cancelled" }); };
    xhr.send(f);
  });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    setMediaMsg(null);
    setUploads(list.map((f) => ({ name: f.name, sent: 0, total: f.size, state: "sending" as const })));
    let ok = 0; const failed: string[] = [];
    // One at a time: these are large, and a serial queue gives an honest bar
    // per file instead of several fighting for the same uplink.
    for (let i = 0; i < list.length; i++) {
      const r = await sendOne(list[i]!, i);
      if (r.ok) ok++; else failed.push(`${list[i]!.name}: ${r.error}`);
    }
    setMediaMsg(failed.length ? failed.join(" · ") : `${ok} saved. Backing up to Backblaze in the background.`);
    loadMedia();
    // The B2 copy lands a few seconds later; refresh once so the "backing up"
    // chip clears itself without the owner wondering.
    setTimeout(loadMedia, 8000);
    if (fileRef.current) fileRef.current.value = "";
    // Leave finished rows up briefly so the result is readable, then clear.
    setTimeout(() => { setUploads([]); setMediaMsg(null); }, failed.length ? 9000 : 4000);
  };

  const removeMedia = async (m: MediaItem) => {
    if (!window.confirm(`Delete ${m.id}? This removes the file for good.`)) return;
    try { await deleteJson(`/api/instagram/media/${encodeURIComponent(m.id)}`); } catch { /* listing will show the truth */ }
    if (logoUrl === m.url) { setLogoUrl(null); try { localStorage.removeItem(LOGO_KEY); } catch { /* private mode */ } }
    loadMedia();
  };

  const pickLogo = (m: MediaItem | null) => {
    const u = m?.url ?? null;
    setLogoUrl(u);
    try { if (u) localStorage.setItem(LOGO_KEY, u); else localStorage.removeItem(LOGO_KEY); } catch { /* private mode */ }
  };

  const copyCaption = async () => {
    try { await navigator.clipboard.writeText(caption); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };

  if (me === null) return <div className="mx-auto max-w-md p-10"><div className="h-40 animate-pulse rounded-xl bg-ink-800/60" /></div>;
  if (!me.ok) return <SignIn onDone={refreshMe} />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl text-white">Instagram Studio</h1>
          <p className="text-xs text-ink-400">
            Built from real moments, real rating moves and real puzzles — nothing invented.
            Students under fair-play review are left out automatically.
          </p>
        </div>
        <span className="text-[11px] text-ink-500">{me.email}</span>
      </div>

      {/* ── media library ─────────────────────────────────────────────── */}
      <section className="mb-5 rounded-xl border border-ink-800 bg-ink-900/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Saved photos &amp; videos</h2>
            <p className="text-[11px] text-ink-500">
              Stored on Backblaze B2 and mirrored locally for speed — wiping this box does not lose them. Pick an image to stamp on every export.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {logoUrl && <button onClick={() => pickLogo(null)} className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:text-white">Clear stamp</button>}
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              onChange={(e) => upload(e.target.files)} className="hidden" id="ig-upload" />
            <label htmlFor="ig-upload"
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${uploading ? "bg-ink-700" : "bg-gradient-to-r from-emerald-500 to-teal-500"}`}>
              {uploading ? "Uploading…" : "Add photo / video"}
            </label>
          </div>
        </div>
        {uploads.length > 0 && (
          <div className="mb-3 space-y-1.5" aria-live="polite">
            {uploads.map((u, i) => {
              const pct = u.state === "done" ? 100 : u.total ? Math.min(100, Math.round((u.sent / u.total) * 100)) : 0;
              const tone = u.state === "error" ? "bg-rose-500" : u.state === "done" ? "bg-emerald-500" : "bg-teal-400";
              return (
                <div key={u.name + i}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="truncate text-ink-300" title={u.name}>{u.name}</span>
                    <span className={`shrink-0 tabular-nums ${u.state === "error" ? "text-rose-300" : "text-ink-400"}`}>
                      {u.state === "error" ? u.error
                        : u.state === "done" ? "saved"
                        : u.state === "finishing" ? "finishing…"
                        : `${pct}% · ${fmtBytes(u.sent)} of ${fmtBytes(u.total)}`}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ink-800">
                    <div className={`h-full rounded-full transition-[width] duration-150 ${tone} ${u.state === "finishing" ? "animate-pulse" : ""}`}
                      style={{ width: `${u.state === "error" ? 100 : pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {mediaMsg && <p className="mb-2 text-[11px] text-ink-300">{mediaMsg}</p>}
        {media === null ? <div className="h-24 animate-pulse rounded-lg bg-ink-800/60" /> : media.length === 0 ? (
          <p className="text-xs text-ink-400">Nothing saved yet. Images up to 12 MB, videos up to 200 MB.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {media.map((m) => (
              <div key={m.id} className={`group relative overflow-hidden rounded-lg border ${logoUrl === m.url ? "border-teal-400" : "border-ink-800"} bg-ink-950`}>
                {m.kind === "video"
                  ? <video src={m.url} className="h-24 w-full object-cover" muted playsInline preload="metadata" />
                  : <img src={m.url} alt={m.id} className="h-24 w-full object-contain" loading="lazy" />}
                {!m.backedUp && (
                  <span className="absolute left-1 top-1 rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-200" title="On the server and serving; the Backblaze copy is still being written">
                    backing up…
                  </span>
                )}
                <div className="flex items-center justify-between gap-1 px-1.5 py-1 text-[10px] text-ink-400">
                  <span className="truncate" title={m.id}>{m.kind === "video" ? "video" : "image"} · {fmtBytes(m.bytes)}</span>
                  <div className="flex shrink-0 gap-1">
                    {m.kind === "image" && (
                      <button onClick={() => pickLogo(m)} title="Stamp this on exports"
                        className={`rounded px-1 ${logoUrl === m.url ? "bg-teal-500/25 text-teal-200" : "hover:bg-ink-800 text-ink-400"}`}>
                        {logoUrl === m.url ? "✓" : "stamp"}
                      </button>
                    )}
                    <a href={m.url} download className="rounded px-1 text-ink-400 hover:bg-ink-800" title="Download">↓</a>
                    <button onClick={() => removeMedia(m)} className="rounded px-1 text-rose-300 hover:bg-ink-800" title="Delete">✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {cards === null ? <div className="h-64 animate-pulse rounded-xl bg-ink-800/60" /> : cards.length === 0 ? (
        <p className="rounded-xl border border-ink-800 bg-ink-900/50 p-4 text-sm text-ink-300">
          Nothing to post yet. Cards appear once students play games with detected moments, climb in puzzles, or once the puzzle set has hard positions.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* sources */}
          <div className="max-h-[560px] overflow-y-auto rounded-xl border border-ink-800 bg-ink-900/40 p-2">
            {cards.map((c) => (
              <button key={c.id} onClick={() => setSel(c.id)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left transition ${sel === c.id ? "bg-teal-500/15 ring-1 ring-teal-400/40" : "hover:bg-ink-800/60"}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-teal-300">{KIND_LABEL[c.kind]}</div>
                <div className="truncate text-sm text-white">{c.title}</div>
                <div className="truncate text-[11px] text-ink-400">{c.subtitle}</div>
              </button>
            ))}
          </div>

          {/* preview + caption */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <canvas ref={canvasRef} className="w-full rounded-xl border border-ink-800 bg-ink-950" style={{ aspectRatio: "1 / 1" }} />
              <p className="mt-1 text-center text-[10px] text-ink-500">1080 × 1080</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400" htmlFor="ig-title">Headline</label>
                <input id="ig-title" value={title} onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-teal-400" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400" htmlFor="ig-sub">Second line</label>
                <input id="ig-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
                  className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-teal-400" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400" htmlFor="ig-cap">Caption</label>
                <textarea id="ig-cap" rows={8} value={caption} onChange={(e) => setCaption(e.target.value)}
                  className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-teal-400" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={download} className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white">Download PNG</button>
                <button onClick={copyCaption} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:text-white">{copied ? "Copied" : "Copy caption"}</button>
                {card?.sourceUrl && <a href={card.sourceUrl} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:text-white">Check the source</a>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
