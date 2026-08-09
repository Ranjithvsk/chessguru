import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import Board from "../components/Board";

// Class-replay page: side-by-side <video> + shared board that scrubs with the
// video's currentTime. Timeline JSON (uploaded as a sidecar to the .webm — see
// class-recording.controller.ts) is a list of { tMs, move } stamps relative to
// record-start. On mount we precompute a FEN for each move so scrubbing is O(1)
// per timeupdate tick instead of replaying chess.js from move 0 every frame.

type WsMove = { from: string; to: string; promotion?: string };
type TimelineEvent = { tMs: number; move: WsMove };
type Snap = { _id: string; classId: string; fen: string; note?: string; byName?: string; at: string; shapes?: Array<{ orig: string; dest?: string; brush?: string }> };

// Filenames are ISO timestamps with colons/dots replaced by "-", suffixed .webm
// (see class-recording.controller.ts). Restore them so new Date() parses:
//   "2026-08-09T14-32-15-234Z.webm" → "2026-08-09T14:32:15.234Z"
function parseFilenameUploadTime(filename: string): number | null {
  const stem = filename.replace(/\.webm$/, "");
  const m = stem.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

// Wire path helpers — mirror the ones in Class.tsx so this file can be lifted
// out of the main class module cleanly.
function classApiPath(roomId: string, suffix = ""): string {
  const base = (import.meta.env.VITE_API_BASE ?? "").toString();
  return `${base}/api/class/${encodeURIComponent(roomId)}${suffix}`;
}
function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s - m * 60).padStart(2, "0")}`;
}

// Precompute [fen, lastMove] snapshots after each timeline event so the
// scrub-to-time lookup below is cheap.
type Snapshot = { fen: string; lastMove: WsMove | null };
function buildSnapshots(events: TimelineEvent[]): Snapshot[] {
  const c = new Chess();
  const out: Snapshot[] = [];
  for (const e of events) {
    try {
      const applied = c.move({ from: e.move.from, to: e.move.to, promotion: (e.move.promotion as any) || "q" });
      if (!applied) continue;
    } catch { continue; }
    out.push({ fen: c.fen(), lastMove: e.move });
  }
  return out;
}

// Find the index of the last event whose tMs <= t. Linear scan — fine for the
// few-hundred moves a class actually contains; binary search is overkill.
function findIndexAtTime(events: TimelineEvent[], tMs: number): number {
  let i = -1;
  for (let k = 0; k < events.length; k++) {
    if (events[k]!.tMs <= tMs) i = k; else break;
  }
  return i;
}

export default function ClassReplayPage() {
  const { id, filename } = useParams<{ id: string; filename: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [tMs, setTMs] = useState(0);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [durationMs, setDurationMs] = useState(0);

  // Fetch the sidecar timeline. Missing sidecar (recording from before Phase 4) is
  // fine — the video still plays, board just stays at starting position.
  useEffect(() => {
    if (!id || !filename) return;
    let cancelled = false;
    setLoadingTimeline(true);
    fetch(classApiPath(id, `/recording/${encodeURIComponent(filename)}/timeline`))
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setEvents(Array.isArray(j?.events) ? j.events : []); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoadingTimeline(false); });
    return () => { cancelled = true; };
  }, [id, filename]);

  // Fetch snaps for this class — dot markers on the video timeline for every
  // moment the coach hit Snap during class. Endpoint returns any snap ever
  // taken in the room; we filter to the ones that fall inside this recording's
  // window using the parsed upload-time in the filename minus video.duration.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(classApiPath(id, `/snaps`), { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setSnaps(Array.isArray(j?.snaps) ? j.snaps : []); })
      .catch(() => { if (!cancelled) setSnaps([]); });
    return () => { cancelled = true; };
  }, [id]);

  // Snap → tMs within this recording. Precomputed once we know both the file
  // upload time (parsed from filename) and the loaded video duration. Snaps
  // outside the window (before start / after end) are dropped. shapes carried
  // through so click-marker → overlay-arrows-on-board works below.
  type Marker = { id: string; tMs: number; note: string; by: string; shapes: Array<{ orig: string; dest?: string; brush?: string }> };
  const snapMarkers = useMemo<Marker[]>(() => {
    if (!filename || durationMs <= 0) return [];
    const uploadEndMs = parseFilenameUploadTime(filename);
    if (uploadEndMs == null) return [];
    const recordStartMs = uploadEndMs - durationMs;
    const out: Marker[] = [];
    for (const s of snaps) {
      const at = new Date(s.at).getTime();
      if (!Number.isFinite(at)) continue;
      const t = at - recordStartMs;
      if (t < 0 || t > durationMs) continue;
      out.push({ id: s._id, tMs: t, note: s.note || "", by: s.byName || "", shapes: Array.isArray(s.shapes) ? s.shapes : [] });
    }
    return out;
  }, [snaps, filename, durationMs]);
  // While a snap marker is active, overlay that snap's shapes on the board.
  // Auto-clears when the playhead drifts more than 2s from the snap time so
  // the arrows don't hang around into unrelated territory after playback.
  const [activeSnapId, setActiveSnapId] = useState<string | null>(null);
  const activeSnap = activeSnapId ? snapMarkers.find((m) => m.id === activeSnapId) : undefined;
  useEffect(() => {
    if (!activeSnap) return;
    if (Math.abs(tMs - activeSnap.tMs) > 2000) setActiveSnapId(null);
  }, [tMs, activeSnap]);

  const snapshots = useMemo(() => buildSnapshots(events), [events]);
  const idx = useMemo(() => findIndexAtTime(events, tMs), [events, tMs]);
  const view: Snapshot = idx >= 0 ? snapshots[idx]! : { fen: new Chess().fen(), lastMove: null };
  const lastMoveArrow: [Key, Key] | undefined = view.lastMove
    ? [view.lastMove.from as Key, view.lastMove.to as Key] : undefined;

  // requestAnimationFrame drives the tMs from the <video> element. onTimeUpdate
  // fires ~4×/sec which is too coarse; rAF gives smooth board reveals.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) setTMs(v.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Also handle scrubbing: seeked/timeupdate fires when the user drags the bar
  // — rAF is paused (video is paused), so pick up the new position here.
  const onSeek = () => { const v = videoRef.current; if (v) setTMs(v.currentTime * 1000); };

  // Jump the video to a specific move — click in the moves list.
  const jumpTo = (ms: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = ms / 1000;
    setTMs(ms);
  };

  // Keep the active move-row visible in the moves scroller as playback
  // advances. Only nudges when the highlighted row is out of view; block=nearest
  // avoids jumpy behaviour when the user is manually scrolling nearby.
  const activeMoveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeMoveRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [idx]);

  // Keyboard nav: ← / → step through moves, Space toggles play/pause. Bail
  // if focus is in a text input so typing in a chat/URL field still works.
  useEffect(() => {
    const isTextField = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTextField(e.target)) return;
      if (e.key === "ArrowRight") {
        if (idx + 1 < events.length) { e.preventDefault(); jumpTo(events[idx + 1]!.tMs); }
      } else if (e.key === "ArrowLeft") {
        if (idx > 0) { e.preventDefault(); jumpTo(events[idx - 1]!.tMs); }
        else if (idx === 0 && events[0]) { e.preventDefault(); jumpTo(events[0].tMs); }
      } else if (e.key === " " || e.code === "Space") {
        const v = videoRef.current; if (!v) return;
        e.preventDefault();
        if (v.paused) v.play().catch(() => {}); else v.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, events]);

  if (!id || !filename) {
    return <div className="py-16 text-center text-ink-400">Missing class or filename.</div>;
  }

  return (
    <div className="grid gap-4 lg:h-[calc(100dvh-6.5rem)] lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      {/* Board column: shows the position at the currently-playing timestamp. */}
      <section className="min-w-0 lg:overflow-y-auto lg:pr-1">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-500">Replay</div>
            <h1 className="font-display text-lg text-white">Class · <span className="tabular-nums text-brand-300">{id}</span></h1>
          </div>
          <Link to={`/class/${encodeURIComponent(id)}`}
            className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-semibold text-ink-200 hover:bg-ink-700">
            ← Back to class
          </Link>
        </div>
        <Board fen={view.fen} orientation="white" viewOnly lastMove={lastMoveArrow}
          shapes={activeSnap && activeSnap.shapes.length > 0 ? (activeSnap.shapes as any) : undefined} />
        <div className="mt-3 rounded-xl2 border border-ink-700 bg-ink-900 p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-300">🎯 Move timeline</span>
            <span className="text-[10px] text-ink-500">
              {loadingTimeline ? "loading…" : `${events.length} move${events.length === 1 ? "" : "s"}`}
              {snapMarkers.length > 0 && <span className="ml-2 text-amber-300">📸 {snapMarkers.length} snap{snapMarkers.length === 1 ? "" : "s"}</span>}
              <span className="ml-2 hidden sm:inline text-ink-600" title="Keyboard: ← / → step moves, Space play/pause">⌨️ ← → ␣</span>
            </span>
          </div>
          {!loadingTimeline && events.length === 0 ? (
            <div className="text-[11px] text-ink-500">No board timeline for this recording (made before board-sync capture landed).</div>
          ) : (
            <div className="max-h-56 overflow-y-auto pr-1">
              <ol className="space-y-0.5">
                {events.map((e, i) => (
                  <li key={i}>
                    <button ref={i === idx ? activeMoveRef : undefined} onClick={() => jumpTo(e.tMs)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors ${i === idx
                        ? "bg-brand-500/20 text-brand-100"
                        : "text-ink-300 hover:bg-ink-800"}`}>
                      <span className="tabular-nums text-[10px] text-ink-500">{fmtDuration(e.tMs)}</span>
                      <span className="font-mono">{e.move.from}{e.move.to}{e.move.promotion || ""}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>

      {/* Video column: standard <video controls>. Native seek bar drives the board
          via the rAF loop above. Controls include full-screen for classroom playback.
          Snap marker strip under the video (only when we have any) — amber dots
          positioned by percentage across the recording; click to jump to that moment
          in both video and board. */}
      <section className="min-w-0 lg:min-h-0 flex flex-col">
        <div className="flex-1 overflow-hidden rounded-xl2 border border-ink-700 bg-black">
          <video ref={videoRef} controls playsInline preload="metadata"
            onSeeked={onSeek} onTimeUpdate={onSeek}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (Number.isFinite(v.duration) && v.duration > 0) setDurationMs(v.duration * 1000);
            }}
            src={classApiPath(id, `/recording/${encodeURIComponent(filename)}`)}
            className="h-full w-full" />
        </div>
        {snapMarkers.length > 0 && durationMs > 0 && (
          <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
            <div className="mb-1 flex items-baseline justify-between text-[10px]">
              <span className="uppercase tracking-wide text-ink-400">📸 Snap markers</span>
              <span className="text-ink-500">click to jump</span>
            </div>
            <div className="relative h-4">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ink-700" />
              {snapMarkers.map((m) => (
                <button key={m.id} onClick={() => { jumpTo(m.tMs); setActiveSnapId(m.id); }}
                  title={`${fmtDuration(m.tMs)} — ${m.by}${m.note ? ` · ${m.note}` : ""}${m.shapes.length > 0 ? ` · ✏️${m.shapes.length}` : ""}`}
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow transition-all hover:h-4 hover:w-4
                    ${activeSnapId === m.id
                      ? "border-white bg-amber-300 ring-2 ring-amber-200/70"
                      : "border-amber-300 bg-amber-500 hover:bg-amber-400"}`}
                  style={{ left: `${(m.tMs / durationMs) * 100}%` }} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
