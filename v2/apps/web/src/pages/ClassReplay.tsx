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
        <Board fen={view.fen} orientation="white" viewOnly lastMove={lastMoveArrow} />
        <div className="mt-3 rounded-xl2 border border-ink-700 bg-ink-900 p-3">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-300">🎯 Move timeline</span>
            <span className="text-[10px] text-ink-500">
              {loadingTimeline ? "loading…" : `${events.length} move${events.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {!loadingTimeline && events.length === 0 ? (
            <div className="text-[11px] text-ink-500">No board timeline for this recording (made before board-sync capture landed).</div>
          ) : (
            <div className="max-h-56 overflow-y-auto pr-1">
              <ol className="space-y-0.5">
                {events.map((e, i) => (
                  <li key={i}>
                    <button onClick={() => jumpTo(e.tMs)}
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
          via the rAF loop above. Controls include full-screen for classroom playback. */}
      <section className="min-w-0 lg:min-h-0">
        <div className="h-full overflow-hidden rounded-xl2 border border-ink-700 bg-black">
          <video ref={videoRef} controls playsInline preload="metadata"
            onSeeked={onSeek} onTimeUpdate={onSeek}
            src={classApiPath(id, `/recording/${encodeURIComponent(filename)}`)}
            className="h-full w-full" />
        </div>
      </section>
    </div>
  );
}
