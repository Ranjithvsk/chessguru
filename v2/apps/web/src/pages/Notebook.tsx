// Student notebook — inbox for position packs that coaches broadcast from
// a live Dream Meet class (📤 Send position button in ClassV2). Three
// vertical tabs on the left: Online class (received packs, default), My
// notes (placeholder for Phase 2 personal notes), Revise (placeholder for
// Phase 2 replay-and-score). Coach who sent a pack sees it here too, with a
// "you sent this" chip, so they can review the same list students see.
//
// Data comes from /api/me/notebook (all packs where I'm a recipient OR I'm
// the coach) and /api/notebook/:packId (full detail with history). See
// class-position-packs.controller.ts for the schema.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { Chess } from "chess.js";
import type { Key } from "chessground/types";
import { get } from "../lib/api";
import Board from "../components/Board";

type PackListItem = {
  _id: string;
  classId: string;
  classTitle: string;
  coachId: string;
  coachName: string;
  sentAt: string;
  title: string;
  startFen: string;
  cursorIdx: number;
  currentFen: string;
  recipientCount: number;
  sentByMe: boolean;
};
type PackListResp = { packs: PackListItem[] };
type BestAttempt = { scorePct: number; correctCount: number; totalPly: number; tookMs: number; finishedAt: string };
type PackDetail = PackListItem & {
  history: Array<{ from: string; to: string; promotion?: string }>;
  bestAttempt: BestAttempt | null;
};
type MyAttempt = { packId: string; scorePct: number; correctCount: number; totalPly: number; tookMs: number; finishedAt: string };
type MyAttemptsResp = { attempts: MyAttempt[] };
type LeaderboardRow = { rank: number; userId: string; username: string; name: string; totalScore: number; packsRevised: number; avgScore: number };
type LeaderboardResp = { rows: LeaderboardRow[] };

// Group packs by calendar-day so the list reads as "Today · Yesterday · Aug
// 25" headers rather than one flat scroll — matches the notebook metaphor.
function groupByDay(packs: PackListItem[]): Array<{ key: string; label: string; items: PackListItem[] }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yday = new Date(today); yday.setDate(yday.getDate() - 1);
  const fmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
  const map = new Map<string, PackListItem[]>();
  for (const p of packs) {
    const d = new Date(p.sentAt); d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const rows: Array<{ key: string; label: string; items: PackListItem[] }> = [];
  for (const [key, items] of map) {
    const d = new Date(key);
    let label: string;
    if (d.getTime() === today.getTime()) label = "Today";
    else if (d.getTime() === yday.getTime()) label = "Yesterday";
    else label = fmt.format(d);
    rows.push({ key, label, items });
  }
  return rows;
}

function PackMiniBoard({ fen }: { fen: string }) {
  return (
    <div className="w-full">
      <Board fen={fen} coordinates={false} viewOnly dests={new Map() as any} />
    </div>
  );
}

// Compact PGN preview — first ~8 plies from startFen/history. Numbering
// respects the starting FEN's move counter + side to move, so a pack from
// a setup position doesn't restart at "1.".
function pgnPreview(startFen: string, history: Array<{ from: string; to: string; promotion?: string }>, plies = 8): string {
  try {
    const c = new Chess(startFen);
    const parts: string[] = [];
    for (let i = 0; i < Math.min(history.length, plies); i++) {
      const m = history[i]!;
      const turn = c.turn();
      const num = Number(c.fen().split(" ")[5] || "1");
      const applied = c.move({ from: m.from, to: m.to, promotion: (m.promotion as any) || "q" });
      if (!applied) break;
      if (turn === "w") parts.push(`${num}. ${applied.san}`);
      else if (parts.length === 0) parts.push(`${num}... ${applied.san}`);
      else parts.push(applied.san);
    }
    return parts.join(" ") + (history.length > plies ? " …" : "");
  } catch { return ""; }
}

function OnlineClassList({ packs }: { packs: PackListItem[] }) {
  const groups = useMemo(() => groupByDay(packs), [packs]);
  if (packs.length === 0) {
    return (
      <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-8 text-center">
        <div className="text-4xl">📭</div>
        <div className="mt-3 font-display text-lg text-white">No positions yet</div>
        <div className="mt-1 text-sm text-ink-400">
          When your coach clicks <span className="rounded bg-brand-500/20 px-1.5 py-0.5 font-mono text-brand-200">📤 Send position</span> during a live class, it'll land here.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-2 flex items-center gap-2">
            <div className="rounded-full bg-brand-500/20 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-brand-200">{g.label}</div>
            <div className="text-[11px] text-ink-500">{g.items.length} {g.items.length === 1 ? "position" : "positions"}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((p) => (
              <Link
                key={p._id}
                to={`/notebook/${p._id}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-gradient-to-br from-ink-900 to-ink-950 shadow-lg transition hover:border-brand-500/50 hover:shadow-brand-500/10"
              >
                <div className="p-2">
                  <PackMiniBoard fen={p.currentFen} />
                </div>
                <div className="flex-1 border-t border-ink-800 bg-ink-900/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-sm font-bold text-white">{p.title}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-400">
                        {p.sentByMe ? "You sent this" : `From ${p.coachName}`} · {p.classTitle}
                      </div>
                    </div>
                    {p.sentByMe && (
                      <span className="shrink-0 rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                        Sent
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-ink-500">
                    <span>{new Date(p.sentAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{p.recipientCount} student{p.recipientCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviseHistory({ packs }: { packs: PackListItem[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ["notebook-attempts"],
    queryFn: () => get<MyAttemptsResp>("/api/me/notebook/attempts"),
    staleTime: 15_000,
  });
  const packById = useMemo(() => new Map(packs.map((p) => [p._id, p])), [packs]);
  if (isLoading) return <div className="text-sm text-ink-500">Loading…</div>;
  const attempts = data?.attempts ?? [];
  if (attempts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-10 text-center">
        <div className="text-5xl">🔁</div>
        <div className="mt-4 font-display text-lg text-white">Nothing revised yet</div>
        <div className="mt-2 text-sm text-ink-400">
          Open a pack from <span className="rounded bg-brand-500/20 px-1.5 py-0.5 font-mono text-brand-200">📚 Online class</span> and hit Revise to try to replay the moves. Best score per pack goes to the leaderboard.
        </div>
      </div>
    );
  }
  // Best-per-pack view for a clean scoreboard.
  const bestByPack = new Map<string, MyAttempt>();
  for (const a of attempts) {
    const cur = bestByPack.get(a.packId);
    if (!cur || a.scorePct > cur.scorePct || (a.scorePct === cur.scorePct && a.tookMs < cur.tookMs)) {
      bestByPack.set(a.packId, a);
    }
  }
  const rows = [...bestByPack.values()].sort((a, b) => b.scorePct - a.scorePct || a.tookMs - b.tookMs);
  const totalScore = rows.reduce((s, r) => s + r.scorePct, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">Total score</div>
          <div className="mt-1 font-display text-3xl font-bold text-white">{totalScore}</div>
          <div className="text-[11px] text-emerald-200/70">across {rows.length} pack{rows.length === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-xl border border-brand-500/40 bg-gradient-to-br from-brand-500/15 to-brand-500/5 p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-brand-300">Packs revised</div>
          <div className="mt-1 font-display text-3xl font-bold text-white">{rows.length}</div>
          <div className="text-[11px] text-brand-200/70">out of {packs.filter((p) => !p.sentByMe).length} received</div>
        </div>
        <Link to="#leaderboard" className="group rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-amber-500/5 p-4 transition hover:border-amber-400/60">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Leaderboard</div>
          <div className="mt-1 font-display text-2xl font-bold text-white">🏆 View →</div>
          <div className="text-[11px] text-amber-200/70">See your rank in the academy</div>
        </Link>
      </div>
      <div className="rounded-xl border border-ink-800 bg-ink-900/60">
        <div className="border-b border-ink-800 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-ink-500">Best per pack</div>
        <div className="divide-y divide-ink-800">
          {rows.map((a) => {
            const p = packById.get(a.packId);
            const color = a.scorePct >= 90 ? "text-emerald-300" : a.scorePct >= 70 ? "text-brand-300" : a.scorePct >= 50 ? "text-amber-300" : "text-rose-300";
            return (
              <Link key={a.packId} to={`/notebook/${a.packId}/revise`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-800/50">
                <div className={`font-mono text-lg font-bold ${color}`}>{a.scorePct}%</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{p?.title ?? "Position"}</div>
                  <div className="text-[10px] text-ink-500">{a.correctCount}/{a.totalPly} correct · {Math.round(a.tookMs / 1000)}s</div>
                </div>
                <div className="text-[10px] text-ink-500">Try again →</div>
              </Link>
            );
          })}
        </div>
      </div>
      <NotebookLeaderboard />
    </div>
  );
}

function NotebookLeaderboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["notebook-leaderboard"],
    queryFn: () => get<LeaderboardResp>("/api/academy/notebook-leaderboard"),
    staleTime: 30_000,
  });
  const rows = data?.rows ?? [];
  return (
    <div id="leaderboard" className="scroll-mt-4 rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-amber-500/5">
      <div className="border-b border-amber-500/20 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-300">🏆 Academy Notebook leaderboard</div>
      {isLoading ? (
        <div className="p-4 text-xs text-ink-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-xs text-ink-500">No revisions yet — be the first to score.</div>
      ) : (
        <div className="divide-y divide-amber-500/10">
          {rows.slice(0, 20).map((r) => {
            const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`;
            return (
              <div key={r.userId} className="flex items-center gap-3 px-4 py-2 hover:bg-amber-500/5">
                <div className="w-8 shrink-0 text-center font-mono text-sm">{medal}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{r.name}</div>
                  <div className="text-[10px] text-ink-500">{r.packsRevised} pack{r.packsRevised === 1 ? "" : "s"} · avg {r.avgScore}%</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-base font-bold text-amber-200">{r.totalScore}</div>
                  <div className="text-[10px] text-ink-500">total</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Placeholder({ icon, title, note }: { icon: string; title: string; note: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-10 text-center">
      <div className="text-5xl">{icon}</div>
      <div className="mt-4 font-display text-lg text-white">{title}</div>
      <div className="mt-2 text-sm text-ink-400">{note}</div>
      <div className="mt-4 text-[11px] uppercase tracking-widest text-ink-500">Coming in Phase 2</div>
    </div>
  );
}

type Section = "online-class" | "my-notes" | "revise";
const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: "online-class", label: "Online class",  icon: "📚" },
  { id: "my-notes",     label: "My notes",      icon: "✍️" },
  { id: "revise",       label: "Revise",        icon: "🔁" },
];

export default function NotebookPage() {
  // Deep-link from a Revise finish screen — /notebook#leaderboard drops the
  // user straight into the Revise tab where the leaderboard lives.
  const [section, setSection] = useState<Section>(() => {
    if (typeof window !== "undefined" && window.location.hash === "#leaderboard") return "revise";
    return "online-class";
  });
  const { data, isLoading } = useQuery({
    queryKey: ["notebook"],
    queryFn: () => get<PackListResp>("/api/me/notebook"),
    staleTime: 30_000,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-white">📓 Notebook</h1>
        <div className="text-xs text-ink-500">
          Positions your coach shares from live classes land here.
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Left rail — 3 sections. Top three lines as the owner asked. */}
        <nav className="space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                section === s.id
                  ? "border-brand-500/60 bg-brand-500/15 text-white shadow-inner shadow-brand-500/20"
                  : "border-ink-800 bg-ink-900/50 text-ink-300 hover:border-ink-700 hover:bg-ink-800/60 hover:text-white"
              }`}
            >
              <span className="text-lg">{s.icon}</span>
              <span className="font-semibold">{s.label}</span>
              {s.id === "online-class" && data && (
                <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  data.packs.length > 0 ? "bg-brand-500/25 text-brand-100" : "bg-ink-800 text-ink-500"
                }`}>
                  {data.packs.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Main pane */}
        <div>
          {section === "online-class" && (
            isLoading ? (
              <div className="text-sm text-ink-500">Loading…</div>
            ) : (
              <OnlineClassList packs={data?.packs ?? []} />
            )
          )}
          {section === "my-notes" && (
            <Placeholder icon="✍️" title="Your personal chess notes" note="Jot down ideas, positions to remember, tactics you missed." />
          )}
          {section === "revise" && <ReviseHistory packs={data?.packs ?? []} />}
        </div>
      </div>
    </div>
  );
}

// Pack detail page — /notebook/:packId. Full board + full notation, "back
// to notebook" link. Phase 2 will layer revise mode + share-forward here.
export function NotebookPackDetailPage() {
  const { packId = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["notebook-pack", packId],
    queryFn: () => get<PackDetail>(`/api/notebook/${encodeURIComponent(packId)}`),
    enabled: !!packId,
  });

  const notation = useMemo(() => {
    if (!data) return [];
    const out: Array<{ ply: number; san: string; num: number; turn: "w" | "b" }> = [];
    try {
      const c = new Chess(data.startFen);
      for (let i = 0; i < data.history.length; i++) {
        const m = data.history[i]!;
        const turn = c.turn();
        const num = Number(c.fen().split(" ")[5] || "1");
        const applied = c.move({ from: m.from, to: m.to, promotion: (m.promotion as any) || "q" });
        if (!applied) break;
        out.push({ ply: i + 1, san: applied.san, num, turn });
      }
    } catch { /* leave whatever we got */ }
    return out;
  }, [data]);

  if (isLoading) return <div className="p-8 text-sm text-ink-500">Loading…</div>;
  if (error || !data) return (
    <div className="p-8 text-center">
      <div className="text-4xl">🤔</div>
      <div className="mt-3 font-display text-lg text-white">Position not found</div>
      <div className="mt-1 text-sm text-ink-400">It may have been removed, or you might not have access.</div>
      <button onClick={() => navigate("/notebook")} className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">← Back to Notebook</button>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/notebook" className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">← Notebook</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold text-white">{data.title}</h1>
          <div className="mt-0.5 truncate text-xs text-ink-400">
            {data.sentByMe ? "You sent this" : `From ${data.coachName}`} · {data.classTitle} · {new Date(data.sentAt).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-2xl border border-ink-800 bg-ink-950/60 p-3 shadow-lg">
          <Board fen={data.currentFen} coordinates viewOnly dests={new Map() as any} />
          <div className="mt-2 truncate font-mono text-[10px] text-ink-500" title={data.currentFen}>{data.currentFen}</div>
        </div>
        <div className="rounded-2xl border border-ink-800 bg-ink-900/60 p-3 self-start">
          <div className="text-[10px] font-bold uppercase tracking-widest text-ink-500">Moves</div>
          <div className="mt-2 max-h-[420px] overflow-y-auto font-mono text-sm text-ink-100">
            {notation.length === 0 ? (
              <div className="text-xs text-ink-500">No moves — just the position.</div>
            ) : (
              notation.map((n) => (
                <span key={n.ply} className="mr-1.5">
                  {n.turn === "w" ? <span className="text-ink-500">{n.num}. </span> : (n.ply === 1 && <span className="text-ink-500">{n.num}… </span>)}
                  <span>{n.san}</span>
                </span>
              ))
            )}
          </div>
          <div className="mt-4 border-t border-ink-800 pt-3">
            {data.history.length === 0 ? (
              <div className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2 text-center text-[11px] text-ink-500">
                No moves in this pack — nothing to revise.
              </div>
            ) : data.sentByMe ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-center text-[11px] text-amber-200">
                You sent this pack — only recipients can revise + score.
              </div>
            ) : (
              <Link
                to={`/notebook/${data._id}/revise`}
                className="block w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-center text-sm font-bold text-white shadow hover:brightness-110"
              >
                🔁 Revise this position
              </Link>
            )}
            {data.bestAttempt && (
              <div className="mt-2 flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-1.5 text-[11px] text-ink-300">
                <span>Your best</span>
                <span className="font-mono text-emerald-300">
                  {data.bestAttempt.scorePct}% · {data.bestAttempt.correctCount}/{data.bestAttempt.totalPly}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Revise-mode page — /notebook/:packId/revise. Student replays every ply of
// the pack's history from startFen; each attempt is checked against the
// expected move, correct/incorrect is tallied, and at the end the score is
// POSTed to /api/notebook/:packId/revise. Uses a legal-moves map so the
// chessground drag feels the same as everywhere else in the app.
export function NotebookReviseSessionPage() {
  const { packId = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["notebook-pack", packId],
    queryFn: () => get<PackDetail>(`/api/notebook/${encodeURIComponent(packId)}`),
    enabled: !!packId,
  });

  // Per-ply state — cursorPly is the next-expected ply (0..history.length),
  // game holds a chess.js instance the board renders from. Rebuilt whenever
  // the pack loads so a refresh restarts the drill cleanly.
  const gameRef = useRef<Chess>(new Chess());
  const [fen, setFen] = useState<string>(() => new Chess().fen());
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [cursorPly, setCursorPly] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [mistakes, setMistakes] = useState<Array<{ ply: number; expected: string; got: string }>>([]);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const [posting, setPosting] = useState(false);
  const [scoreResp, setScoreResp] = useState<{ scorePct: number; correctCount: number; totalPly: number } | null>(null);
  const startedRef = useRef<number>(Date.now());

  // Boot: seed game with startFen and orient the board toward the side who
  // moves first — that's the student's perspective (their move first).
  useEffect(() => {
    if (!data) return;
    try {
      const c = new Chess(data.startFen);
      gameRef.current = c;
      setFen(c.fen());
      setOrientation(c.turn() === "b" ? "black" : "white");
      setCursorPly(0); setCorrect(0); setMistakes([]);
      setFeedback(null); setFinished(false); setScoreResp(null);
      startedRef.current = Date.now();
    } catch { /* pack unusable; leave defaults */ }
  }, [data]);

  const total = data?.history.length ?? 0;
  // Dests map for chessground — legal moves for the side to move only. When
  // finished we clamp to empty so the student can't keep dragging.
  const dests = useMemo(() => {
    if (finished) return new Map<Key, Key[]>();
    const g = gameRef.current;
    const m = new Map<Key, Key[]>();
    for (const mv of (g.moves({ verbose: true }) as any[])) {
      const arr = m.get(mv.from as Key) ?? [];
      arr.push(mv.to as Key);
      m.set(mv.from as Key, arr);
    }
    return m;
  }, [fen, finished]);

  const submitResult = async (correctCount: number, totalPly: number, mistakesFinal: typeof mistakes) => {
    setPosting(true);
    try {
      const r = await fetch(`/v2api/api/notebook/${encodeURIComponent(packId)}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          correctCount, totalPly,
          tookMs: Date.now() - startedRef.current,
          mistakes: mistakesFinal,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) {
        setScoreResp({ scorePct: j.scorePct, correctCount: j.correctCount, totalPly: j.totalPly });
        qc.invalidateQueries({ queryKey: ["notebook-attempts"] });
        qc.invalidateQueries({ queryKey: ["notebook-pack", packId] });
      }
    } catch { /* silent — user already sees the local score */ }
    setPosting(false);
  };

  const onMove = (fromKey: Key, toKey: Key, promo?: string) => {
    if (finished || !data) return;
    const expected = data.history[cursorPly];
    if (!expected) return;
    const from = String(fromKey), to = String(toKey);
    // Apply the student's guess to a scratch copy so we can compute SAN both
    // for the guess AND for the expected move (for feedback + mistake log).
    const isCorrect = (from === expected.from && to === expected.to
                       && (!expected.promotion || !promo || expected.promotion === promo));
    // Regardless of correctness, we ADVANCE the drill by applying the
    // EXPECTED move — otherwise a wrong guess would leave the board on an
    // unexpected FEN and the rest of the pack wouldn't line up. Owner ask
    // pattern: revise like the puzzles trainer, one shot per ply.
    let expectedSan = "??";
    try {
      const g = gameRef.current;
      const applied = g.move({ from: expected.from, to: expected.to, promotion: (expected.promotion as any) || "q" });
      if (applied) expectedSan = applied.san;
    } catch { /* keep "??" */ }
    let gotSan = expectedSan;
    if (!isCorrect) {
      // Compute the SAN of the student's guess on a scratch board (from BEFORE
      // the expected move applied) so the mistake log records what they tried.
      try {
        const idx = gameRef.current.history().length - 1;
        const scratch = new Chess(data.startFen);
        for (let i = 0; i < idx; i++) {
          const m = data.history[i]!;
          scratch.move({ from: m.from, to: m.to, promotion: (m.promotion as any) || "q" });
        }
        const applied = scratch.move({ from, to, promotion: (promo as any) || "q" });
        if (applied) gotSan = applied.san;
        else gotSan = `${from}${to}`;
      } catch { gotSan = `${from}${to}`; }
    }

    const nextPly = cursorPly + 1;
    const nextCorrect = correct + (isCorrect ? 1 : 0);
    const nextMistakes = isCorrect ? mistakes : [...mistakes, { ply: cursorPly + 1, expected: expectedSan, got: gotSan }];
    setFen(gameRef.current.fen());
    setCursorPly(nextPly);
    setCorrect(nextCorrect);
    setMistakes(nextMistakes);
    setFeedback({ kind: isCorrect ? "ok" : "err", msg: isCorrect ? `✓ ${expectedSan}` : `✗ You played ${gotSan}, best was ${expectedSan}` });
    // Autoclear the feedback so it doesn't linger past the next move.
    setTimeout(() => { setFeedback(null); }, 1200);

    if (nextPly >= total) {
      setFinished(true);
      void submitResult(nextCorrect, total, nextMistakes);
    }
  };

  if (isLoading) return <div className="p-8 text-sm text-ink-500">Loading…</div>;
  if (error || !data) return (
    <div className="p-8 text-center">
      <div className="text-4xl">🤔</div>
      <div className="mt-3 font-display text-lg text-white">Position not found</div>
      <button onClick={() => navigate("/notebook")} className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">← Back to Notebook</button>
    </div>
  );

  if (data.sentByMe) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <div className="text-5xl">✋</div>
      <div className="mt-3 font-display text-lg text-white">You sent this pack</div>
      <div className="mt-1 text-sm text-ink-400">Only recipients can revise + score. Coach view (student scores) ships in Phase 3.</div>
      <Link to={`/notebook/${packId}`} className="mt-4 inline-block rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-ink-200">Back to pack</Link>
    </div>
  );

  if (data.history.length === 0) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <div className="text-4xl">📍</div>
      <div className="mt-3 font-display text-lg text-white">Nothing to revise</div>
      <div className="mt-1 text-sm text-ink-400">This pack is a static position — no moves were sent with it.</div>
    </div>
  );

  const scorePct = total ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/notebook/${packId}`} className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800">← Pack</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-bold text-white">🔁 Revise: {data.title}</h1>
          <div className="mt-0.5 truncate text-xs text-ink-400">{data.coachName} · {data.classTitle}</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-2xl border border-ink-800 bg-ink-950/60 p-3 shadow-lg">
          <Board
            fen={fen}
            orientation={orientation}
            movableColor={finished ? undefined : (gameRef.current.turn() === "w" ? "white" : "black")}
            dests={dests as any}
            coordinates
            onMove={onMove}
          />
          {feedback && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-center text-sm font-semibold ${
              feedback.kind === "ok" ? "bg-emerald-500/20 text-emerald-100" : "bg-rose-500/20 text-rose-100"
            }`}>
              {feedback.msg}
            </div>
          )}
        </div>

        <div className="space-y-3 self-start">
          {!finished ? (
            <>
              <div className="rounded-xl border border-brand-500/40 bg-gradient-to-br from-brand-500/15 to-brand-500/5 p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-brand-300">Progress</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <div className="font-display text-2xl font-bold text-white">{cursorPly}</div>
                  <div className="text-sm text-ink-400">/ {total} moves</div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all" style={{ width: `${(cursorPly / total) * 100}%` }} />
                </div>
              </div>
              <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
                <div className="flex justify-between text-[11px]">
                  <div><span className="text-emerald-300 font-mono text-base font-bold">{correct}</span> <span className="text-ink-500">correct</span></div>
                  <div><span className="text-rose-300 font-mono text-base font-bold">{mistakes.length}</span> <span className="text-ink-500">mistakes</span></div>
                </div>
                <div className="mt-2 text-[10px] text-ink-500">
                  Play the move you think came next. One shot per ply — either way we advance.
                </div>
              </div>
              <div className="rounded-lg border border-ink-800 bg-ink-900/60 px-3 py-2 text-center text-[11px] text-ink-400">
                {gameRef.current.turn() === "w" ? "White" : "Black"} to move
              </div>
            </>
          ) : (
            <>
              <div className={`rounded-xl border p-4 text-center ${
                scorePct >= 90 ? "border-emerald-500/50 bg-gradient-to-br from-emerald-500/20 to-emerald-500/5"
                : scorePct >= 70 ? "border-brand-500/50 bg-gradient-to-br from-brand-500/20 to-brand-500/5"
                : scorePct >= 50 ? "border-amber-500/50 bg-gradient-to-br from-amber-500/20 to-amber-500/5"
                : "border-rose-500/50 bg-gradient-to-br from-rose-500/20 to-rose-500/5"
              }`}>
                <div className="text-4xl">{scorePct >= 90 ? "🏆" : scorePct >= 70 ? "👍" : scorePct >= 50 ? "💪" : "📚"}</div>
                <div className="mt-2 font-display text-4xl font-bold text-white">{scorePct}%</div>
                <div className="mt-1 text-sm text-ink-200">{correct} / {total} correct</div>
                {posting && <div className="mt-2 text-[10px] text-ink-500">Saving…</div>}
                {scoreResp && <div className="mt-2 text-[11px] text-emerald-300">✓ Score added to leaderboard</div>}
              </div>
              {mistakes.length > 0 && (
                <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-rose-300">Mistakes</div>
                  <div className="mt-2 space-y-1 text-[11px] font-mono">
                    {mistakes.map((m) => (
                      <div key={m.ply} className="flex items-center justify-between gap-2">
                        <span className="text-ink-500">Ply {m.ply}</span>
                        <span><span className="text-rose-300">{m.got}</span> <span className="text-ink-500">vs</span> <span className="text-emerald-300">{m.expected}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <button
                  onClick={() => { setFinished(false); startedRef.current = Date.now();
                    try {
                      const c = new Chess(data.startFen);
                      gameRef.current = c;
                      setFen(c.fen()); setOrientation(c.turn() === "b" ? "black" : "white");
                      setCursorPly(0); setCorrect(0); setMistakes([]); setFeedback(null); setScoreResp(null);
                    } catch { /* keep state */ }
                  }}
                  className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-bold text-white shadow hover:brightness-110"
                >🔁 Revise again</button>
                <Link to="/notebook" className="rounded-lg border border-ink-700 bg-ink-900 px-4 py-2 text-center text-sm text-ink-200 hover:bg-ink-800">← Back to Notebook</Link>
                <Link to="#leaderboard" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-200 hover:bg-amber-500/20">🏆 View leaderboard</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
