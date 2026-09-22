// Replay a finished class from its event log (owner 2026-09-22).
//
// Distinct from ClassReplay.tsx, which plays back a coach's screen RECORDING
// (.webm + a move sidecar) and only exists when the coach pressed record. This
// one is always available: class-ws appends every teaching action to classEvents
// with a timestamp, so any class taught since 22 September 2026 can be walked
// through in the order it actually happened.
//
// Reads history only, so nobody is notified by it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { Key } from "chessground/types";
import Board from "../components/Board";
import { get } from "../lib/api";

type Ev = {
  at: string; type: string; fen: string | null;
  move: { from: string; to: string; san?: string } | null;
  cursorIdx: number | null; locked: boolean | null; hidden: boolean | null;
};
type Replay = {
  ok: true; classId: string; title: string; coachUserId: string | null;
  startAt: string | null; endedAt: string | null;
  events: Ev[];
  attendance: { userId: string | null; name: string | null; joinedAt: string | null; lastSeenAt: string | null }[];
};

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const hhmm = (v?: string | null) => (v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
const LABEL: Record<string, string> = {
  move: "move", reset: "board reset", annot: "arrows & circles", lock: "board lock",
  orientation: "flipped the board", seek: "jumped to a move", loadFen: "loaded a position",
  takeback: "takeback", "load-tree": "loaded a line", "annotate-move": "move comment",
  notation: "notation panel", challenge_start: "challenge started", challenge_end: "challenge ended",
};

type Rec = { name: string; bytes: number; createdAt: string };

export default function ClassEventReplay() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Replay | null>(null);
  // Audio and video only exist if somebody recorded the class — the call itself
  // is not captured. When a recording IS there, show it here rather than making
  // the viewer find the separate player.
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await get<Replay>(`/api/class/${encodeURIComponent(id)}/replay`);
        if (!dead) { setData(r); setI(0); }
      } catch { if (!dead) setErr("You are not allowed to see this class, or it does not exist."); }
    })();
    return () => { dead = true; };
  }, [id]);

  useEffect(() => {
    let dead = false;
    get<{ recordings: Rec[] }>(`/api/class/${encodeURIComponent(id)}/recordings`)
      .then((r) => { if (!dead) setRecs(r.recordings ?? []); })
      .catch(() => { if (!dead) setRecs([]); });   // no access or none — same to the page
    return () => { dead = true; };
  }, [id]);

  // Carry the last known position forward: an event that changed an arrow rather
  // than the pieces must leave the board where it was, not blank it.
  const positions = useMemo(() => {
    const out: string[] = [];
    let cur = START;
    for (const e of data?.events ?? []) { if (e.fen) cur = e.fen; out.push(cur); }
    return out;
  }, [data]);

  const total = data?.events.length ?? 0;
  useEffect(() => {
    if (!playing || !total) return;
    timer.current = window.setTimeout(() => {
      setI((n) => { if (n + 1 >= total) { setPlaying(false); return total - 1; } return n + 1; });
    }, 900);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [playing, i, total]);

  if (err) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-5 text-rose-900">
          <div className="text-lg font-bold">Cannot replay this class</div>
          <p className="mt-1 text-sm">{err}</p>
          <Link to="/dashboard" className="mt-3 inline-block text-sm underline">Back to dashboard</Link>
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-ink-400">Loading the class…</div>;

  const ev: Ev | null = data.events[i] ?? null;
  const fen = positions[i] ?? START;
  const lastMove: [Key, Key] | undefined =
    ev?.move?.from && ev?.move?.to ? [ev.move.from as Key, ev.move.to as Key] : undefined;

  return (
    <div className="mx-auto max-w-6xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-black uppercase tracking-wider text-white">⏪ Replay</span>
        <h1 className="text-lg font-black text-ink-900">{data.title}</h1>
        <span className="text-xs text-ink-400">{hhmm(data.startAt)} → {data.endedAt ? hhmm(data.endedAt) : "not ended"}</span>
        <div className="flex-1" />
        <Link to={`/watch/${encodeURIComponent(id)}`} className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-bold text-ink-700 hover:bg-ink-50">👁 Watch live</Link>
      </header>

      {total === 0 ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <div className="font-bold">Nothing recorded for this class.</div>
          <p className="mt-1 text-sm">
            The event log started on 22 September 2026, so classes taught before then have none —
            and a class where nobody moved a piece records nothing either.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {recs && recs.length > 0 && (
              <div className="mb-3">
                <video
                  controls preload="metadata"
                  className="w-full rounded-xl border border-ink-200 bg-black"
                  src={`/v2api/api/class/${encodeURIComponent(id)}/recording/${encodeURIComponent(recs[0]!.name)}`}
                />
                <div className="mt-1 text-[11px] text-ink-400">
                  Recording · {(recs[0]!.bytes / 1048576).toFixed(1)} MB
                  {recs.length > 1 ? ` · ${recs.length - 1} more not shown` : ""}
                  {" · "}
                  <Link to={`/class/${encodeURIComponent(id)}/replay/${encodeURIComponent(recs[0]!.name)}`} className="underline">
                    open the synced player
                  </Link>
                </div>
              </div>
            )}
            {recs !== null && recs.length === 0 && (
              <p className="mb-3 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-[11px] text-ink-500">
                No audio or video for this class. The lesson call is not recorded — only the board is
                logged — so a replay has picture only when somebody recorded the class.
              </p>
            )}
            <Board fen={fen} lastMove={lastMove} viewOnly coordinates />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => { setPlaying(false); setI(0); }} className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-xs font-bold">⏮</button>
              <button onClick={() => { setPlaying(false); setI((n) => Math.max(0, n - 1)); }} className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-xs font-bold">◀</button>
              <button onClick={() => setPlaying((p) => !p)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-black text-white">{playing ? "⏸ Pause" : "▶ Play"}</button>
              <button onClick={() => { setPlaying(false); setI((n) => Math.min(total - 1, n + 1)); }} className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-xs font-bold">▶</button>
              <button onClick={() => { setPlaying(false); setI(total - 1); }} className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-xs font-bold">⏭</button>
              <input type="range" min={0} max={Math.max(0, total - 1)} value={i}
                onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }}
                className="ml-1 min-w-[140px] flex-1" aria-label="Scrub the class" />
              <span className="w-20 text-right font-mono text-xs tabular-nums text-ink-500">{i + 1}/{total}</span>
            </div>
            {ev && (
              <div className="mt-2 text-xs text-ink-500">
                <b>{LABEL[ev.type] ?? ev.type}</b>
                {ev.move?.san ? <> · <span className="font-mono">{ev.move.san}</span></> : null}
                {" · "}{new Date(ev.at).toLocaleTimeString()}
              </div>
            )}
          </div>

          <aside className="min-w-0 space-y-4">
            <section className="rounded-xl border border-ink-200 bg-white p-3">
              <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-ink-500">Who was there</div>
              {data.attendance.length === 0 ? <div className="text-xs text-ink-400">Nobody joined.</div> : (
                <ul className="space-y-1 text-xs">
                  {data.attendance.map((a, k) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="truncate font-semibold text-ink-800">{a.name || a.userId || "—"}</span>
                      <span className="shrink-0 font-mono tabular-nums text-ink-400">{hhmm(a.joinedAt)}→{hhmm(a.lastSeenAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-xl border border-ink-200 bg-white p-3">
              <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-ink-500">Timeline</div>
              <ol className="max-h-[420px] space-y-0.5 overflow-y-auto text-xs">
                {data.events.map((e, k) => (
                  <li key={k}>
                    <button onClick={() => { setPlaying(false); setI(k); }}
                      className={`flex w-full justify-between gap-2 rounded px-1.5 py-1 text-left ${k === i ? "bg-violet-100 font-bold text-violet-900" : "text-ink-600 hover:bg-ink-50"}`}>
                      <span className="truncate">{LABEL[e.type] ?? e.type}{e.move?.san ? ` ${e.move.san}` : ""}</span>
                      <span className="shrink-0 font-mono tabular-nums text-ink-400">{hhmm(e.at)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
