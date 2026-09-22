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
import { get, post } from "../lib/api";
import { teamFlag } from "../lib/country-flag";
import Board from "../components/Board";
import MoveTable from "../components/MoveTable";

type LiveRound = { roundId: string; tourName: string; roundName: string; url?: string; boards: number; updatedAt: string; following?: boolean; state?: "live" | "playing" | "soon" | "finished"; startsAt?: number | null; tourId?: string | null };
type LiveGame = {
  board: number;
  whiteName: string; blackName: string;
  whiteElo?: number | null; blackElo?: number | null;
  whiteClock?: string | null; blackClock?: string | null;
  whiteTitle?: string | null; blackTitle?: string | null;
  whiteFideId?: string | null; blackFideId?: string | null;
  timeControl?: string | null; eco?: string | null; openingName?: string | null;
  turn?: "w" | "b" | null; clockAsOf?: string | null;
  whiteTeam?: string | null; blackTeam?: string | null;
  event?: string | null;
  result: string; ply: number; fen: string; lastMove?: string | null;
  finished: boolean; updatedAt: string; moves: string[];
};

const POLL_MS = 4000;

/** Lichess splits a big event into one broadcast per section, named
 *  "Event | Category | Range" — the FIDE Olympiad is NINE of them. Listed flat
 *  they swamp everything else, so they are grouped under the event and the
 *  sections shown inside it. Everything before the first "|" is the event. */
function eventOf(tourName: string): string {
  const i = String(tourName).indexOf("|");
  return (i > 0 ? tourName.slice(0, i) : tourName).trim();
}
function sectionOf(tourName: string): string | null {
  const i = String(tourName).indexOf("|");
  return i > 0 ? tourName.slice(i + 1).replace(/\s*\|\s*/g, " · ").trim() : null;
}
function groupRounds(rounds: LiveRound[]): { event: string; rounds: LiveRound[] }[] {
  const by = new Map<string, LiveRound[]>();
  for (const r of rounds) {
    const k = eventOf(r.tourName);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }
  return [...by.entries()].map(([event, rs]) => ({ event, rounds: rs }));
}

/** "in 6m" / "in 3h" / "tomorrow 14:30" — a multi-day event can be a day and a
 *  half from its next round, and "2310m" is not an answer anyone wants. */
function formatIn(ts: number): string {
  const mins = Math.max(0, Math.round((ts - Date.now()) / 60000));
  if (mins < 90) return `starts in ${mins}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `starts in ${Math.round(hrs)}h`;
  const d = new Date(ts);
  const day = hrs < 48 ? "tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" });
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function LiveBroadcast() {
  const { roundId } = useParams();
  return roundId ? <RoundBoards roundId={roundId} /> : <LiveIndex />;
}

// ── what is on air ───────────────────────────────────────────────────
function LiveIndex() {
  const q = useQuery<{ ok: boolean; rounds: LiveRound[]; cycleSec?: number; throttled?: boolean }>({
    queryKey: ["live-index"],
    queryFn: () => get("/api/live-broadcast"),
    refetchInterval: 15_000,
  });
  const all = q.data?.rounds ?? [];
  // Two very different things were sharing one list: rounds being played right
  // now, and rounds scheduled up to two days out. With a multi-section event
  // like the Olympiad (nine sections, all starting at once) the upcoming rows
  // simply buried the live ones.
  const rounds = all.filter((r) => r.state === "live" || r.state === "playing");
  const upcoming = all
    .filter((r) => r.state === "soon")
    .sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
          Live broadcast
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Every tournament on air right now — all of them are followed, not a
          chosen few.
        </p>
      </header>

      {/* Say how fresh this is rather than implying instant. Every live round
        *  is polled in rotation, so a board is at most one cycle behind. */}
      {/* Count what we actually POLL, not what is listed: the upcoming rounds
        *  below are shown but not fetched, and claiming to follow 33 rounds
        *  when six are in play overstates it. */}
      {!!rounds.length && (
        <div className="mb-3 text-xs text-ink-500">
          Following {rounds.length} round{rounds.length === 1 ? "" : "s"} in play
          {q.data?.cycleSec ? <> · every board refreshed about every {q.data.cycleSec}s</> : null}
          {q.data?.throttled && <span className="ml-1 text-amber-300">· rate limited, catching up</span>}
        </div>
      )}

      {/* Upcoming is collapsed by default: it is the longer list and the
        *  shorter one is what people came for. */}
      {q.isLoading ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center text-sm text-ink-400">Looking for live rounds…</div>
      ) : rounds.length === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
          <div className="text-sm text-ink-300">
            Nothing is being played this minute{upcoming.length ? " — see what is coming up below" : ""}.
          </div>
          <div className="mt-1 text-xs text-ink-500">
            Rounds appear here the moment a tournament goes on air. Meanwhile there are 1.09M finished games in{" "}
            <Link to="/database" className="text-brand-300 hover:underline">ChessGuru DB</Link>.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {groupRounds(rounds).map((grp) => grp.rounds.length > 1
            ? <EventGroup key={grp.event} event={grp.event} rounds={grp.rounds} />
            : grp.rounds.map((r) => (
            <Link key={r.roundId} to={`/live/${r.roundId}`}
              className="flex items-center gap-3 rounded-xl2 border border-ink-700 bg-ink-900 px-4 py-3 hover:border-brand-500/50 hover:bg-ink-900">
              <span className={`h-2 w-2 shrink-0 rounded-full ${
                r.state === "live" ? "animate-pulse bg-rose-500"
                : r.state === "playing" ? "bg-amber-400" : "bg-ink-600"}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-white">{r.tourName}</div>
                <div className="text-xs text-ink-400">
                  {r.roundName}
                  {r.boards > 0 && <> · {r.boards} board{r.boards === 1 ? "" : "s"}</>}
                  {/* We hold open connections only for rounds people are
                    *  watching. Everything else is listed and loads on open. */}
                  {/* Upstream flags `live` only once it is receiving moves, so
                    *  a round that has begun but sent nothing yet reads as
                    *  "playing" rather than being hidden. */}
                  {r.state === "playing" && <span className="ml-1 text-amber-300">· in play</span>}
                  {r.state === "soon" && r.startsAt && (
                    <span className="ml-1 text-ink-500">· {formatIn(r.startsAt)}</span>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-xs text-ink-500">Watch →</span>
            </Link>
          )))}
        </div>
      )}

      {upcoming.length > 0 && <UpcomingRounds rounds={upcoming} />}
    </div>
  );
}

/** One row for a multi-section event, opening to its sections — the Olympiad
 *  is Open and Women across nine board ranges, and nine separate rows for one
 *  tournament is not what anyone means by "the Olympiad". */
function EventGroup({ event, rounds }: { event: string; rounds: LiveRound[] }) {
  const [open, setOpen] = useState(false);
  const boards = rounds.reduce((n, r) => n + (r.boards ?? 0), 0);
  const anyLive = rounds.some((r) => r.state === "live");
  return (
    <div className="overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-900">
        <span className={`h-2 w-2 shrink-0 rounded-full ${anyLive ? "animate-pulse bg-rose-500" : "bg-amber-400"}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{event}</div>
          <div className="text-xs text-ink-400">
            {rounds.length} sections · {boards} board{boards === 1 ? "" : "s"}
          </div>
        </div>
        <span className="shrink-0 text-xs text-ink-500">{open ? "Hide" : "Sections"} {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-ink-800 bg-ink-950/40">
          {rounds.map((r) => <SectionRow key={r.roundId} r={r} />)}
        </div>
      )}
    </div>
  );
}

/** An event that is not playing yet, still openable: its sections, and through
 *  them every round it has already played. */
function UpcomingGroup({ event, rounds }: { event: string; rounds: LiveRound[] }) {
  const [open, setOpen] = useState(false);
  const first = rounds[0]!;
  return (
    <div className="overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-900/70">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink-200">{event}</div>
          <div className="text-[11px] text-ink-500">
            {rounds.length > 1 ? `${rounds.length} sections · ${first.roundName}` : first.roundName}
          </div>
        </div>
        {first.startsAt && <span className="shrink-0 text-[11px] text-ink-400">{formatIn(first.startsAt)}</span>}
        <span className="shrink-0 text-[11px] text-ink-500">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="border-t border-ink-800/70 bg-ink-950/40">
          {rounds.map((r) => <SectionRow key={r.roundId} r={r} />)}
        </div>
      )}
    </div>
  );
}

/** One section of an event — "Open · Matches 1-12" — expanding to every round
 *  it has played as well as the one in progress. Without this a tournament has
 *  no past: you could watch round 7 and never read round 6.
 *  (owner: "i can't see past results and game in a tournament why") */
function SectionRow({ r }: { r: LiveRound }) {
  const [open, setOpen] = useState(false);
  const q = useQuery<{ ok: boolean; rounds: { roundId: string; roundName: string; state: string; boards: number }[] }>({
    queryKey: ["tour-rounds", r.tourId],
    queryFn: () => get(`/api/live-broadcast/tour/${r.tourId}`),
    enabled: open && !!r.tourId,
    staleTime: 60_000,
  });
  const rounds = q.data?.rounds ?? [];

  return (
    <div className="border-b border-ink-800/60 last:border-0">
      <div className="flex items-center gap-3 px-4 py-2 hover:bg-ink-900">
        <Link to={`/live/${r.roundId}`} className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink-100">{sectionOf(r.tourName) ?? r.roundName}</div>
          <div className="text-[11px] text-ink-500">
            {r.roundName}
            {r.boards > 0 && <> · {r.boards} boards</>}
            {r.state === "playing" && <span className="ml-1 text-amber-300">· in play</span>}
          </div>
        </Link>
        {r.tourId && (
          <button onClick={() => setOpen(!open)}
            className="shrink-0 rounded-lg border border-brand-500/50 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold text-brand-100 hover:bg-brand-500/20">
            {open ? "Hide rounds" : "All rounds"}
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-wrap gap-1 px-4 pb-2">
          {q.isLoading && <span className="text-[11px] text-ink-500">Loading rounds…</span>}
          {rounds.map((rd) => (
            <Link key={rd.roundId} to={`/live/${rd.roundId}`}
              title={`${rd.roundName}${rd.boards ? ` · ${rd.boards} boards` : ""}`}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                rd.state === "live" ? "bg-rose-500/20 text-rose-100"
                : rd.state === "playing" ? "bg-amber-500/20 text-amber-100"
                : rd.state === "soon" ? "bg-ink-800 text-ink-500"
                : "bg-ink-800 text-ink-200 hover:bg-ink-700"}`}>
              {rd.roundName.replace(/^Round\s*/i, "R")}
            </Link>
          ))}
          {!q.isLoading && !rounds.length && <span className="text-[11px] text-ink-500">No rounds recorded yet.</span>}
        </div>
      )}
    </div>
  );
}

/** Scheduled rounds, up to two days out. Collapsed, because a big event can
 *  put a dozen sections here at once and none of them is playing yet. */
function UpcomingRounds({ rounds }: { rounds: LiveRound[] }) {
  const [open, setOpen] = useState(false);
  // Grouped here too — this is where a big event actually lands. The Olympiad
  // was nine separate "Coming up" rows for one tournament, which is what
  // prompted the grouping in the first place.
  const groups = useMemo(() => groupRounds(rounds), [rounds]);
  // Show almost everything by default. Collapsing at five hid the FIDE
  // Olympiad behind a toggle purely because nine local qualifiers happened to
  // start a few hours sooner, and a list of ten is not long enough to be worth
  // hiding. Bigger events (more sections) break ties first, so a major
  // tournament is never the one that falls off the end.
  const ranked = useMemo(
    () => [...groups].sort((a, b) => {
      const ta = a.rounds[0]?.startsAt ?? 0, tb = b.rounds[0]?.startsAt ?? 0;
      const sameDay = Math.abs(ta - tb) < 12 * 3600_000;
      if (sameDay && a.rounds.length !== b.rounds.length) return b.rounds.length - a.rounds.length;
      return ta - tb;
    }),
    [groups],
  );
  const shown = open ? ranked : ranked.slice(0, 10);
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Coming up</h2>
        {groups.length > 10 && (
          <button onClick={() => setOpen(!open)} className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold text-brand-100 hover:bg-brand-500/20">
            {open ? "Show fewer" : `Show all ${groups.length}`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {/* These open too. They were static divs, so the Olympiad — which sits
          *  here whenever it is between rounds — could be seen and not
          *  clicked, and its finished rounds were unreachable exactly when
          *  someone went looking for them. */}
        {shown.map((grp) => <UpcomingGroup key={grp.event} event={grp.event} rounds={grp.rounds} />)}
      </div>
    </div>
  );
}

// ── every board on one round ─────────────────────────────────────────
function RoundBoards({ roundId }: { roundId: string }) {
  // Games are kept in a map and patched by `since`, so a board that has not
  // moved keeps its identity (and its DOM) instead of being replaced wholesale.
  const [games, setGames] = useState<Map<number, LiveGame>>(new Map());
  const [meta, setMeta] = useState<{ tourName: string; roundName: string; ongoing: boolean; tourId?: string | null } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [tab, setTab] = useState<"boards" | "players" | "teams">("boards");
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
        if (r?.round) setMeta({ tourName: r.round.tourName, roundName: r.round.roundName, ongoing: !!r.round.ongoing, tourId: r.round.tourId ?? null });
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
  useTick(list.some((g) => !g.finished));   // one timer for the whole page
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

      {/* Boards / Players / Teams, as the reference viewer has them. Players
        *  and Teams are computed from the broadcast games we hold, which is
        *  why they carry the same caveat Lichess puts on its own. */}
      <div className="mb-4 flex gap-1 border-b border-ink-700">
        {(["boards", "players", "teams"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold capitalize transition-colors ${
              tab === t ? "border-brand-500 text-brand-100" : "border-transparent text-ink-400 hover:text-ink-100"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab !== "boards" && meta?.tourId && <Standings tourId={meta.tourId} tab={tab} />}

      {tab === "boards" && focused && <FocusedGame g={focused} onClose={() => setFocus(null)} />}

      {/* A team event is scored by MATCH, not by board: the Olympiad pairs two
        *  countries across four boards and the match score is what anyone
        *  actually wants to know. Only rendered when the feed states teams. */}
      {tab === "boards" && <TeamScores games={list} />}

      {tab !== "boards" ? null : list.length === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center text-sm text-ink-400">
          Waiting for the first boards…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g) => (
            <button key={g.board} onClick={() => setFocus(g.board === focus ? null : g.board)}
              className={`rounded-xl2 border p-4 text-left transition-colors ${
                focus === g.board ? "border-brand-500/60 bg-brand-500/10" : "border-ink-700 bg-ink-900 hover:border-brand-500/50"}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Board {g.board}</span>
                <span className={`font-mono text-[11px] ${
                  g.result === "1-0" ? "text-emerald-300" : g.result === "0-1" ? "text-rose-300"
                  : g.result === "1/2-1/2" ? "text-ink-300" : "text-ink-500"}`}>
                  {g.result === "*" ? `${Math.ceil(g.ply / 2)}.` : g.result}
                </span>
              </div>
              {/* The same chessground the rest of the app uses, view-only.
                *  It was a glyph grid to keep twenty boards cheap, but the
                *  owner wants our board everywhere — so the preview is the
                *  real thing, without coordinates at this size. */}
              <Board fen={g.fen} orientation="white" viewOnly coordinates={false} />
              <div className="mt-2 space-y-0.5">
                <PlayerLine name={g.whiteName} elo={g.whiteElo} clock={g.whiteClock} title={g.whiteTitle} team={g.whiteTeam} small running={!g.finished && g.turn === "w"} asOf={g.clockAsOf} />
                <PlayerLine name={g.blackName} elo={g.blackElo} clock={g.blackClock} title={g.blackTitle} team={g.blackTeam} small running={!g.finished && g.turn === "b"} asOf={g.clockAsOf} />
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
  useTick(!g.finished);

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
    <div className="mb-5 rounded-xl2 border border-brand-500/40 bg-ink-900 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Board {g.board}
            {g.eco && <span className="ml-1.5 font-mono normal-case text-ink-400">{g.eco}</span>}
            {g.openingName && <span className="ml-1 normal-case tracking-normal text-ink-400">{g.openingName}</span>}
            {g.timeControl && <span className="ml-1.5 normal-case tracking-normal text-ink-600">· {g.timeControl}</span>}
          </div>
          <PlayerLine name={g.whiteName} elo={g.whiteElo} clock={g.whiteClock} title={g.whiteTitle} team={g.whiteTeam} running={!g.finished && g.turn === "w"} asOf={g.clockAsOf} />
          <PlayerLine name={g.blackName} elo={g.blackElo} clock={g.blackClock} title={g.blackTitle} team={g.blackTeam} running={!g.finished && g.turn === "b"} asOf={g.clockAsOf} />
        </div>
        <button onClick={onClose} className="shrink-0 text-xs text-ink-400 hover:text-white">Close</button>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="mx-auto w-full max-w-[min(100%,34rem)] md:mx-0">
          <Board fen={fen} orientation="white" viewOnly coordinates
                 lastMove={lastMove as any} />
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Moves</span>
            {following
              ? <span className="flex items-center gap-1 text-[11px] text-rose-300">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />live
                </span>
              : <button onClick={() => setPly(null)} className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-2.5 py-1 text-[11px] font-semibold text-brand-100 hover:bg-brand-500/20">Back to live →</button>}
          </div>
          <MoveTable sans={g.moves} ply={shown} onPick={(n) => setPly(n >= livePly ? null : n)}
                     className="max-h-[22rem] overflow-y-auto rounded-lg border border-ink-800 bg-ink-950/50 p-2" />
          {g.result !== "*" && (
            <div className="mt-2 rounded-lg bg-ink-950/60 py-1.5 text-center font-mono text-sm text-ink-100">{g.result}</div>
          )}
          {/* The same action the puzzle page offers on a position, on a game.
            * It goes through /api/studies/from-pgn, so a game already in the
            * library is LINKED rather than copied and the annotations stay
            * private to whoever saved it. */}
          <SaveGameButton g={g} />
        </div>
      </div>
    </div>
  );
}

/** Parse "1:02:29" / "12:05" into seconds. */
function clockSecs(c?: string | null): number | null {
  if (!c) return null;
  const p = String(c).split(":").map(Number);
  if (p.some((n) => !Number.isFinite(n))) return null;
  if (p.length === 3) return p[0]! * 3600 + p[1]! * 60 + p[2]!;
  if (p.length === 2) return p[0]! * 60 + p[1]!;
  return null;
}
const fmtClock = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), sec = v % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
};

/** One second of wall clock, shared by every board on the page — a timer per
 *  clock would be forty timers on a busy round. */
function useTick(active: boolean): number {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => bump((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Date.now();
}

/** Match scores, aggregated from the boards. A win is 1, a draw a half, and a
 *  game still in progress counts for neither side — so the score shown is what
 *  has actually been decided, with the number of unfinished boards stated
 *  rather than silently rounded away. */
function TeamScores({ games }: { games: LiveGame[] }) {
  const matches = useMemo(() => {
    const by = new Map<string, { a: string; b: string; aPts: number; bPts: number; open: number; boards: number }>();
    for (const g of games) {
      const wt = g.whiteTeam, bt = g.blackTeam;
      if (!wt || !bt) continue;
      // Teams alternate colours down the boards, so the pair is keyed in a
      // stable order and each board's points are credited to whichever side
      // of that pair actually played them.
      const a = wt < bt ? wt : bt;
      const b = wt < bt ? bt : wt;
      const k = `${a}|${b}`;
      if (!by.has(k)) by.set(k, { a, b, aPts: 0, bPts: 0, open: 0, boards: 0 });
      const m = by.get(k)!;
      m.boards++;
      if (g.result === "1-0") { if (wt === a) m.aPts += 1; else m.bPts += 1; }
      else if (g.result === "0-1") { if (bt === a) m.aPts += 1; else m.bPts += 1; }
      else if (g.result === "1/2-1/2") { m.aPts += 0.5; m.bPts += 0.5; }
      else m.open++;
    }
    return [...by.values()].sort((x, y) => y.boards - x.boards);
  }, [games]);

  if (!matches.length) return null;
  const fmt = (n: number) => (n % 1 ? `${Math.floor(n)}½` : String(n));

  return (
    <div className="mb-5 rounded-xl2 border border-ink-700 bg-ink-900 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Match scores</div>
      <div className="grid gap-1 sm:grid-cols-2">
        {matches.map((m) => (
          <div key={`${m.a}|${m.b}`} className="flex items-center gap-2 rounded-lg bg-ink-950/40 px-2.5 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {teamFlag(m.a) && <span className="mr-1">{teamFlag(m.a)}</span>}
              <span className="text-ink-100">{m.a}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums text-ink-100">{fmt(m.aPts)}–{fmt(m.bPts)}</span>
            <span className="min-w-0 flex-1 truncate text-right">
              <span className="text-ink-100">{m.b}</span>
              {teamFlag(m.b) && <span className="ml-1">{teamFlag(m.b)}</span>}
            </span>
            {m.open > 0 && <span className="shrink-0 text-[10px] text-amber-300">{m.open} playing</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

type StandingsResp = {
  ok: boolean; roundsCounted: number; roundsTotal: number;
  players: { name: string; title: string | null; elo: number | null; team: string | null; score: number; played: number }[];
  teams: { team: string; matchPts: number; gamePts: number; matches: number; avgRating: number | null }[];
};

/** Player and team tables for the whole tournament, not just this round. */
function Standings({ tourId, tab }: { tourId: string; tab: "players" | "teams" }) {
  const [q, setQ] = useState("");
  const r = useQuery<StandingsResp>({
    queryKey: ["standings", tourId],
    queryFn: () => get(`/api/live-broadcast/tour/${tourId}/standings`),
    refetchInterval: 30_000,
  });
  if (r.isLoading) return <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center text-sm text-ink-400">Working out the standings…</div>;
  const d = r.data;
  if (!d?.ok) return null;
  const fmt = (n: number) => (n % 1 ? `${Math.floor(n) || ""}½` : String(n));

  const note = (
    // The same caveat the reference viewer carries, for the same reason: these
    // are BROADCAST games, and a round nobody has opened contributes nothing.
    <p className="mb-3 text-[11px] text-ink-500">
      ⓘ Calculated from broadcast games ({d.roundsCounted} of {d.roundsTotal} rounds) — may differ from official results.
    </p>
  );

  if (tab === "teams") {
    return (
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Team results</div>
        {note}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="border-b border-ink-800 text-[11px] uppercase tracking-wide text-ink-500">
                <th className="px-2 py-1.5 text-left font-semibold">Team (avg rating)</th>
                <th className="px-2 py-1.5 text-right font-semibold">Match</th>
                <th className="px-2 py-1.5 text-right font-semibold">Game</th>
              </tr>
            </thead>
            <tbody>
              {d.teams.map((t, i) => (
                <tr key={t.team} className="border-b border-ink-800/60">
                  <td className="px-2 py-1.5">
                    <span className="mr-1.5 tabular-nums text-ink-500">{i + 1}</span>
                    {teamFlag(t.team) && <span className="mr-1">{teamFlag(t.team)}</span>}
                    <span className="text-ink-100">{t.team}</span>
                    {t.avgRating && <span className="ml-1.5 text-[11px] tabular-nums text-ink-500">{t.avgRating}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink-100">{t.matchPts}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-300">{fmt(t.gamePts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const rows = needle ? d.players.filter((p) => p.name.toLowerCase().includes(needle)) : d.players;
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Players</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player"
        className="mb-2 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-brand-500" />
      {note}
      <div className="divide-y divide-ink-800/60">
        {rows.slice(0, 100).map((p, i) => (
          <div key={p.name} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="w-7 shrink-0 text-right tabular-nums text-ink-500">{i + 1}</span>
            {p.title && <span className="shrink-0 font-bold text-amber-300">{p.title}</span>}
            {teamFlag(p.team) && <span className="shrink-0">{teamFlag(p.team)}</span>}
            <span className="min-w-0 flex-1 truncate text-ink-100">{p.name}</span>
            {p.elo && <span className="shrink-0 tabular-nums text-ink-500">{p.elo}</span>}
            <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-ink-100">{fmt(p.score)}</span>
          </div>
        ))}
        {!rows.length && <div className="py-4 text-center text-sm text-ink-500">No player matches that.</div>}
      </div>
    </div>
  );
}

function SaveGameButton({ g }: { g: LiveGame }) {
  const [state, setState] = useState<null | "busy" | "done" | "err">(null);
  const save = async () => {
    setState("busy");
    try {
      const head = [
        `[Event "${g.event ?? "Broadcast"}"]`,
        `[White "${g.whiteName}"]`,
        `[Black "${g.blackName}"]`,
        `[Result "${g.result}"]`,
        g.whiteElo ? `[WhiteElo "${g.whiteElo}"]` : null,
        g.blackElo ? `[BlackElo "${g.blackElo}"]` : null,
        g.eco ? `[ECO "${g.eco}"]` : null,
      ].filter(Boolean).join("\n");
      let body = "";
      g.moves.forEach((san, i) => { body += (i % 2 === 0 ? `${i / 2 + 1}. ` : "") + san + " "; });
      await post("/api/studies/from-pgn", {
        pgn: `${head}\n\n${body.trim()} ${g.result}`,
        topic: "gm-game",
        lessonName: `${g.whiteName} vs ${g.blackName}`,
      });
      setState("done");
    } catch { setState("err"); }
  };
  return (
    <button onClick={save} disabled={state === "busy" || state === "done" || !g.moves.length}
      className="mt-2 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
      {state === "busy" ? "Saving…" : state === "done" ? "✓ Saved to My Studies"
        : state === "err" ? "Could not save" : "💾 Save to My Studies"}
    </button>
  );
}

function PlayerLine({ name, elo, clock, title, small, running, asOf, team }: {
  name: string; elo?: number | null; clock?: string | null; title?: string | null; small?: boolean;
  running?: boolean; asOf?: string | null; team?: string | null;
}) {
  // Only a TEAM event states a nationality, so the flag appears there and is
  // simply absent elsewhere rather than guessed.
  const flag = teamFlag(team);
  // The published clock is the player's time AT THEIR LAST MOVE. For the side
  // to move, the time since we read it has been ticking off their clock, so
  // counting down from it is the true figure — not an animation for show.
  const base = clockSecs(clock);
  let shown = clock ?? null;
  if (running && base !== null && asOf) {
    const elapsed = (Date.now() - new Date(asOf).getTime()) / 1000;
    if (elapsed >= 0 && elapsed < 6 * 3600) shown = fmtClock(base - elapsed);
  }
  return (
    <div className={`flex items-baseline gap-1.5 ${small ? "text-xs" : "text-sm"}`}>
      {/* GM / IM / FM, as the broadcast states it. */}
      {flag ? <span className="shrink-0" title={team ?? undefined}>{flag}</span> : null}
      {title ? <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[10px] font-bold text-amber-200">{title}</span> : null}
      <span className="min-w-0 flex-1 truncate font-medium text-ink-100">{name}</span>
      {elo ? <span className="shrink-0 tabular-nums text-ink-500">{elo}</span> : null}
      {/* The clock comes from the movetext, so it is the player's real
        *  remaining time as of the last move — it does not tick down between
        *  refreshes, and pretending otherwise would be a lie. */}
      {shown ? (
        <span className={`shrink-0 rounded px-1 font-mono text-[10px] tabular-nums ${
          running ? "bg-emerald-500/20 text-emerald-100" : "bg-ink-800 text-ink-300"}`}>{shown}</span>
      ) : null}
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
