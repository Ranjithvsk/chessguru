// Live broadcast — tournament games arriving move by move.
// Routes: /live (what is on air) and /live/:roundId (every board on a round)
//
// The API's ingest service holds one streaming connection per live round and
// writes each board's current position to Mongo. This page polls that, which
// is deliberate: a poll survives an API reload, a dropped socket and a phone
// waking from sleep, none of which a long-lived connection does. At a 4s
// interval a viewer is at most four seconds behind the board, and the request
// carries `since` so a 40-board round only sends what actually changed.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Chess } from "chess.js";
import { get } from "../lib/api";
import Board from "../components/Board";
import MoveTable from "../components/MoveTable";

type LiveRound = { roundId: string; tourName: string; roundName: string; url?: string; boards: number; updatedAt: string; following?: boolean };
type LiveGame = {
  board: number;
  whiteName: string; blackName: string;
  whiteElo?: number | null; blackElo?: number | null;
  whiteClock?: string | null; blackClock?: string | null;
  result: string; ply: number; fen: string; lastMove?: string | null;
  finished: boolean; updatedAt: string; moves: string[];
};

const POLL_MS = 4000;

export default function LiveBroadcast() {
  const { roundId } = useParams();
  return roundId ? <RoundBoards roundId={roundId} /> : <LiveIndex />;
}

// ── what is on air ───────────────────────────────────────────────────
function LiveIndex() {
  const q = useQuery<{ ok: boolean; rounds: LiveRound[] }>({
    queryKey: ["live-index"],
    queryFn: () => get("/api/live-broadcast"),
    refetchInterval: 15_000,
  });
  const rounds = q.data?.rounds ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
          Live broadcast
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Every tournament on air right now. Open one and it starts updating move by move.
        </p>
      </header>

      {q.isLoading ? (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-8 text-center text-sm text-ink-400">Looking for live rounds…</div>
      ) : rounds.length === 0 ? (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-8 text-center">
          <div className="text-sm text-ink-300">Nothing is being played right now.</div>
          <div className="mt-1 text-xs text-ink-500">
            Rounds appear here the moment a tournament goes on air. Meanwhile there are 1.09M finished games in{" "}
            <Link to="/database" className="text-brand-300 hover:underline">ChessGuru DB</Link>.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {rounds.map((r) => (
            <Link key={r.roundId} to={`/live/${r.roundId}`}
              className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-3 hover:border-brand-500/50 hover:bg-ink-900">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-white">{r.tourName}</div>
                <div className="text-xs text-ink-400">
                  {r.roundName}
                  {r.boards > 0 && <> · {r.boards} board{r.boards === 1 ? "" : "s"}</>}
                  {/* We hold open connections only for rounds people are
                    *  watching. Everything else is listed and loads on open. */}
                  {r.following && <span className="ml-1 text-rose-300">· following</span>}
                </div>
              </div>
              <span className="shrink-0 text-xs text-ink-500">Watch →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── every board on one round ─────────────────────────────────────────
function RoundBoards({ roundId }: { roundId: string }) {
  // Games are kept in a map and patched by `since`, so a board that has not
  // moved keeps its identity (and its DOM) instead of being replaced wholesale.
  const [games, setGames] = useState<Map<number, LiveGame>>(new Map());
  const [meta, setMeta] = useState<{ tourName: string; roundName: string; ongoing: boolean } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const sinceRef = useRef<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const since = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : "";
        const r = await get<{ ok: boolean; round: any; games: LiveGame[]; serverTime: string }>(`/api/live-broadcast/${roundId}${since}`);
        if (stop) return;
        if (r?.round) setMeta({ tourName: r.round.tourName, roundName: r.round.roundName, ongoing: !!r.round.ongoing });
        if (r?.games?.length) {
          setGames((prev) => {
            const next = new Map(prev);
            for (const g of r.games) next.set(g.board, g);
            return next;
          });
        }
        sinceRef.current = r?.serverTime ?? sinceRef.current;
        setStale(false);
      } catch {
        setStale(true);           // say so rather than showing a frozen board as if it were live
      } finally {
        if (!stop) timer = setTimeout(tick, POLL_MS);
      }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [roundId]);

  const list = useMemo(() => [...games.values()].sort((a, b) => a.board - b.board), [games]);
  const focused = focus != null ? games.get(focus) ?? null : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-4">
        <Link to="/live" className="text-xs text-ink-400 hover:text-white">← All live rounds</Link>
        <h1 className="mt-1 flex items-center gap-2 font-display text-xl font-bold text-white">
          {meta?.ongoing !== false && <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />}
          {meta?.tourName ?? "Live round"}
        </h1>
        <p className="text-sm text-ink-400">
          {meta?.roundName}
          {meta?.ongoing === false && <span className="ml-2 text-ink-500">· round finished</span>}
          {stale && <span className="ml-2 text-amber-300">· reconnecting</span>}
        </p>
      </header>

      {focused && <FocusedGame g={focused} onClose={() => setFocus(null)} />}

      {list.length === 0 ? (
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-8 text-center text-sm text-ink-400">
          Waiting for the first boards…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g) => (
            <button key={g.board} onClick={() => setFocus(g.board === focus ? null : g.board)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                focus === g.board ? "border-brand-500/60 bg-brand-500/10" : "border-ink-800 bg-ink-900/60 hover:border-ink-600"}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Board {g.board}</span>
                <span className={`font-mono text-[11px] ${
                  g.result === "1-0" ? "text-emerald-300" : g.result === "0-1" ? "text-rose-300"
                  : g.result === "1/2-1/2" ? "text-ink-300" : "text-ink-500"}`}>
                  {g.result === "*" ? `${Math.ceil(g.ply / 2)}.` : g.result}
                </span>
              </div>
              <MiniBoard fen={g.fen} />
              <div className="mt-2 space-y-0.5">
                <PlayerLine name={g.whiteName} elo={g.whiteElo} clock={g.whiteClock} small />
                <PlayerLine name={g.blackName} elo={g.blackElo} clock={g.blackClock} small />
              </div>
              {g.lastMove && !g.finished && (
                <div className="mt-1 font-mono text-[11px] text-brand-300">last: {g.lastMove}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The game you are actually watching gets the REAL board and the REAL
 *  notation panel — the same chessground and MoveTable used everywhere else
 *  in the app. The cheap glyph grid stays for the twenty thumbnails, where
 *  forty chessgrounds would be a great deal of DOM for something nobody drags
 *  a piece on; there is no such excuse for the one game in front of you.
 *  (owner, 2026-09-21: "we have nice board and notation panel ... is that in
 *  live broadcast")
 *
 *  Stepping back through a live game is the point of having the notation
 *  panel, so `ply === null` means "follow the live move" and any click pins
 *  you to that move instead. New moves arriving never yank you forward while
 *  you are reading — that is what "Back to live" is for. */
function FocusedGame({ g, onClose }: { g: LiveGame; onClose: () => void }) {
  const [ply, setPly] = useState<number | null>(null);
  const livePly = g.moves.length;
  const shown = ply === null ? livePly : Math.min(ply, livePly);
  const following = ply === null;

  const { fen, lastMove } = useMemo(() => {
    const c = new Chess();
    let lm: [string, string] | undefined;
    for (let i = 0; i < shown; i++) {
      let mv: any = null;
      try { mv = c.move(g.moves[i]!); } catch { break; }
      if (!mv) break;
      lm = [mv.from, mv.to];
    }
    return { fen: c.fen(), lastMove: lm };
  }, [g.moves, shown]);

  // Keyboard, as everywhere else in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setPly(Math.max(0, shown - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setPly(shown + 1 >= livePly ? null : shown + 1); }
      else if (e.key === "Home") { e.preventDefault(); setPly(0); }
      else if (e.key === "End") { e.preventDefault(); setPly(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, livePly]);

  return (
    <div className="mb-5 rounded-xl border border-brand-500/40 bg-ink-900/60 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Board {g.board}</div>
          <PlayerLine name={g.whiteName} elo={g.whiteElo} clock={g.whiteClock} />
          <PlayerLine name={g.blackName} elo={g.blackElo} clock={g.blackClock} />
        </div>
        <button onClick={onClose} className="shrink-0 text-xs text-ink-400 hover:text-white">Close</button>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="mx-auto w-full max-w-[min(100%,28rem)] md:mx-0">
          <Board fen={fen} orientation="white" viewOnly coordinates
                 lastMove={lastMove as any} />
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-500">Moves</span>
            {following
              ? <span className="flex items-center gap-1 text-[11px] text-rose-300">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />live
                </span>
              : <button onClick={() => setPly(null)} className="text-[11px] font-semibold text-brand-300 hover:text-brand-100">Back to live →</button>}
          </div>
          <MoveTable sans={g.moves} ply={shown} onPick={(n) => setPly(n >= livePly ? null : n)}
                     className="max-h-[22rem] overflow-y-auto rounded-lg border border-ink-800 bg-ink-950/50 p-2" />
          {g.result !== "*" && (
            <div className="mt-2 rounded-lg bg-ink-950/60 py-1.5 text-center font-mono text-sm text-ink-100">{g.result}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerLine({ name, elo, clock, small }: { name: string; elo?: number | null; clock?: string | null; small?: boolean }) {
  return (
    <div className={`flex items-baseline gap-1.5 ${small ? "text-xs" : "text-sm"}`}>
      <span className="min-w-0 flex-1 truncate font-medium text-ink-100">{name}</span>
      {elo ? <span className="shrink-0 tabular-nums text-ink-500">{elo}</span> : null}
      {clock ? <span className="shrink-0 rounded bg-ink-800 px-1 font-mono text-[10px] tabular-nums text-ink-300">{clock}</span> : null}
    </div>
  );
}

/** A board drawn straight from a FEN.
 *
 *  Deliberately NOT the full chessground component used elsewhere: a round can
 *  carry forty boards, and forty chessgrounds on one page is a great deal of
 *  DOM and JS for something nobody is dragging pieces on. This is a plain grid
 *  of glyphs — it renders instantly and costs nothing to update. */
function MiniBoard({ fen, big }: { fen: string; big?: boolean }) {
  const rows = useMemo(() => {
    const board = String(fen || "").split(" ")[0] ?? "";
    return board.split("/").map((row) => {
      const cells: string[] = [];
      for (const ch of row) {
        if (/\d/.test(ch)) { for (let i = 0; i < Number(ch); i++) cells.push(""); }
        else cells.push(ch);
      }
      return cells;
    });
  }, [fen]);

  return (
    <div className={`grid aspect-square w-full grid-cols-8 overflow-hidden rounded ${big ? "text-3xl sm:text-4xl" : "text-base"}`}>
      {rows.map((row, r) =>
        row.map((p, c) => (
          <div key={`${r}-${c}`}
            className={`grid place-items-center leading-none ${(r + c) % 2 === 0 ? "bg-[#eadfc8]" : "bg-[#8aa1b8]"}`}>
            {/* Colours are INLINE, not Tailwind classes. `text-white` is
              *  rewritten in light mode by `html.light .text-white { color:
              *  rgb(var(--text-primary)) }`, which turned every white piece
              *  dark and made the two sides identical on the board. Caught by
              *  reading the computed colours: black rgb(0,0,0) and "white"
              *  rgb(15,23,42) — both dark. An inline style is not themed. */}
            <span style={p && p === p.toUpperCase()
              ? { color: "#ffffff", textShadow: "0 0 2px rgba(0,0,0,.9), 0 1px 1px rgba(0,0,0,.6)" }
              : { color: "#101418", textShadow: "0 0 2px rgba(255,255,255,.35)" }}>
              {GLYPH[p] ?? ""}
            </span>
          </div>
        )),
      )}
    </div>
  );
}

// Solid glyphs for both sides, coloured by CSS. Using the hollow white pieces
// makes them vanish on a light square at this size.
const GLYPH: Record<string, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
  P: "♟", N: "♞", B: "♝", R: "♜", Q: "♛", K: "♚",
};

function MoveStrip({ moves, result }: { moves: string[]; result: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest move in view by scrolling THIS strip only — never the page.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [moves.length]);
  if (!moves.length) return null;
  return (
    <div ref={ref} className="mt-3 flex gap-1.5 overflow-x-auto whitespace-nowrap rounded-lg bg-ink-950/60 px-2 py-1.5 font-mono text-xs text-ink-300">
      {moves.map((m, i) => (
        <span key={i} className={i === moves.length - 1 ? "font-bold text-brand-200" : ""}>
          {i % 2 === 0 ? `${i / 2 + 1}.` : ""}{m}
        </span>
      ))}
      {result !== "*" && <span className="font-bold text-ink-100">{result}</span>}
    </div>
  );
}
