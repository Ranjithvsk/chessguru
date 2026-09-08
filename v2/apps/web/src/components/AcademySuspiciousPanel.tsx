// Coach / owner: Fair Play panel — every student in the roster is scored
// 0–100 over the last 30 days (or since their last reset) and listed when in
// Watch (25–59) or Review (60+). Review holds rated gains until the owner
// resets. Backed by GET /api/academy/suspicious-solves and
// GET /api/academy/suspicious-solves/:id (the drawer). Students are never
// told anything from here (owner decision 2026-09-08).
import { useEffect, useState } from "react";
import type React from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/api";

interface Fastest { puzzleId: string; pr: number; ms: number; mvMs: number[] | null; at: string }
interface Components { flags: number; fastHard: number; accuracy: number; crowd: number; climb: number; themeFlat: number; playGap: number }
interface Decision { kind: "clear" | "hold" | "reset"; by: string; note: string; at: string }
interface Recent { userId: string; name: string; kind: "clear" | "hold" | "reset" | "review"; by: string | null; byName: string | null; note: string; score: number | null; at: string }
interface ModelStatus { active: boolean; reason: string; n: { assisted: number; honest: number }; cv: { accuracy: number | null; correct: number; total: number; falseAlarms: number; missed: number }; trainedAt: string }
interface Report {
  month: string; solves: number; flagged: number; activeStudents: number; students: number;
  listed: { userId: string; name: string }[]; falseAlarms: { userId: string; name: string }[]; falseAlarmsPer500: number | null;
  catches: { userId: string; name: string }[]; reviews: number; timeToReviewHours: { median: number | null; n: number; all: number[] };
  decisions: { clear: number; hold: number; reset: number };
  model: ModelStatus & { agreement: { agree: number; total: number } };
  acceptance: { falseAlarms: boolean | null; timeToReview: boolean | null };
}
interface Row {
  userId: string; name: string; ratingNow: number | null; ratingStart: number | null; ratingEnd: number | null; climb: number;
  solves: number; dubious: number; reasons: Record<string, number>;
  hard: { n: number; wins: number; winPct: number | null; medianMs: number | null; fast: number };
  fastest: Fastest[]; score: number; band: "clear" | "watch" | "review"; hold: boolean; components: Components; crowdRatio: number | null;
  reviewSince: string | null; windowStart: string; lastReset: { at: string } | null;
  decision: Decision | null; handScore: number; modelScore: number;
}
interface Solve { pid: string; at: string; pr: number; r: number; w: boolean; ms: number | null; mvMs: number[] | null; dub: boolean; dubr: string[] | null; held: boolean; crowdMedMs: number | null }
interface Detail {
  ok: boolean; error?: string; userId: string; name: string; score: number; band: Row["band"]; hold: boolean; components: Components;
  evidence: { solves: number; flagged: number; reasons: Record<string, number>; hard: Row["hard"]; atLevel: { n: number; winPct: number | null }; above: { n: number; winPct: number | null }; crowdRatio: number | null; ratingStart: number | null; ratingEnd: number | null; climb: number; fastest: { pid: string; pr: number; ms: number; mvMs: number[] | null; at: string }[]; sessions: { day: string; solves: number; wins: number }[]; peakHour: { hour: string; solves: number } | null; themes: { n: number; sd: number; min: number; max: number } | null; play: { speed: string; r: number; nb: number; gap: number } | null };
  windowStart: string; lastReset: string | null; solves: Solve[]; decision: Decision | null; handScore: number; modelScore: number; modelActive: boolean;
}
const REASON_LABEL: Record<string, string> = {
  fast_hard: "2400+ puzzle under 4 s",
  fast_above_level: "300+ above level under 4 s",
  metronome: "even 1–2 s move gaps",
  streak: "run of fast hard wins",
  crowd_fast: "under 15% of crowd time",
  focus_loss: "left the tab, moved on return",
};
const secs = (ms: number) => (ms / 1000).toFixed(1) + "s";
const KIND_LABEL: Record<Recent["kind"], string> = { clear: "Cleared", hold: "Held", reset: "Reset", review: "Entered review" };
type Actor = { userId: string; name: string; hold: boolean };

function DecisionChip({ d }: { d: Decision | null }) {
  if (!d) return null;
  const label = d.kind === "clear" ? "cleared" : d.kind === "hold" ? "held" : "reset";
  return <span className={`rounded-md px-1.5 py-0.5 text-xs ${d.kind === "hold" ? "bg-amber-500/15 text-amber-200" : "bg-ink-800 text-ink-300"}`} title={d.note || undefined}>{label} by {d.by} · {day(d.at)}{d.note ? ` · “${d.note.length > 60 ? d.note.slice(0, 60) + "…" : d.note}”` : ""}</span>;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const names = (xs: { name: string }[]) => (xs.length ? xs.map((x) => x.name).join(", ") : "none");

/** Phase 3: the monthly fairness report — the two acceptance numbers, what
 *  was decided, and where the fitted model stands. */
function FairnessReport() {
  const now = new Date();
  const months = [0, 1, 2].map((i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  const [month, setMonth] = useState(months[0]!);
  const q = useQuery({ queryKey: ["academy-fairplay-report", month], queryFn: () => get<Report>(`/api/academy/fairplay-report?month=${month}`), staleTime: 5 * 60_000 });
  const r = q.data;
  const Row = ({ k, v, ok }: { k: string; v: React.ReactNode; ok?: boolean | null }) => (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-32 shrink-0 text-ink-400">{k}</span>
      <span className="text-ink-200">{v}{ok === true && <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">on target</span>}{ok === false && <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">above target</span>}</span>
    </div>
  );
  return (
    <div className="mt-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3" data-testid="fairness-report">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Fairness report</h3>
        <div className="inline-flex rounded-full border border-ink-700 bg-ink-900 p-0.5 text-[11px]">
          {months.map((m) => <button key={m} onClick={() => setMonth(m)} className={`rounded-full px-2.5 py-0.5 ${month === m ? "bg-ink-700 text-white" : "text-ink-400 hover:underline"}`}>{monthLabel(m)}</button>)}
        </div>
      </div>
      {q.isLoading || !r ? <div className="h-16 animate-pulse rounded-lg bg-ink-800/60" /> : (
        <div className="space-y-1.5">
          <Row k="Solves" v={`${r.solves} by ${r.activeStudents} of ${r.students} students · ${r.flagged} flagged`} />
          <Row k="Put on the list" v={`${r.listed.length} — ${names(r.listed)}`} />
          <Row k="False alarms" v={`${r.falseAlarms.length} (${r.falseAlarmsPer500 ?? "—"} per 500 solves, target under 1) — ${names(r.falseAlarms)}`} ok={r.acceptance.falseAlarms} />
          <Row k="Catches" v={`${r.catches.length} held or reset — ${names(r.catches)}`} />
          <Row k="Time to Review" v={r.timeToReviewHours.median === null ? "no Review this month" : `median ${r.timeToReviewHours.median} h over ${r.timeToReviewHours.n} (target under 24 h)`} ok={r.acceptance.timeToReview} />
          <Row k="Decisions" v={`${r.decisions.clear} cleared · ${r.decisions.hold} held · ${r.decisions.reset} reset`} />
          <Row k="Model" v={`${r.model.reason}. Agrees with the hand score on ${r.model.agreement.agree} of ${r.model.agreement.total} students.`} />
        </div>
      )}
    </div>
  );
}

/** Clear (with note) and Hold, for coach and owner. The server refuses a
 *  coach's Clear on a held student — the owner lifts holds. */
function DecisionButtons({ a, busy, onDecide }: { a: Actor; busy: string | null; onDecide: (a: Actor, kind: "clear" | "hold") => void }) {
  return (
    <>
      <button onClick={() => onDecide(a, "clear")} disabled={busy === a.userId} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50" data-testid="decide-clear">Clear…</button>
      {!a.hold && <button onClick={() => onDecide(a, "hold")} disabled={busy === a.userId} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50" data-testid="decide-hold">Hold…</button>}
    </>
  );
}
const pctStr = (p: number | null) => (p === null ? "n/a" : `${p}%`);
const day = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function BandPill({ band, hold }: { band: Row["band"]; hold: boolean }) {
  if (band === "review") return <span className="rounded-md bg-rose-500/25 px-1.5 py-0.5 text-xs font-semibold text-rose-100" data-testid="band-pill">Review{hold ? " · gains held" : ""}</span>;
  if (band === "watch") return <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-100" data-testid="band-pill">Watch</span>;
  return <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-100" data-testid="band-pill">Clear</span>;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 60 ? "bg-rose-400" : score >= 25 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2" title={`score ${score}/100 · watch at 25 · review at 60`}>
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
        <div className="absolute inset-y-0 left-1/4 w-px bg-ink-600" />
        <div className="absolute inset-y-0 w-px bg-ink-600" style={{ left: "60%" }} />
      </div>
      <span className="font-mono text-[11px] text-ink-300">{score}</span>
    </div>
  );
}

/** Speed vs difficulty: every timed solve in the window. x = puzzle rating,
 *  y = seconds (log). Wins teal, losses hollow, flagged red ring, held amber. */
function Scatter({ solves }: { solves: Solve[] }) {
  const pts = solves.filter((s) => typeof s.ms === "number" && s.ms! > 0);
  if (pts.length < 3) return <div className="text-xs text-ink-500">Not enough timed solves for a chart.</div>;
  const W = 560, H = 220, L = 40, R = 12, T = 12, B = 28;
  const xs = pts.map((p) => p.pr);
  const xMin = Math.floor((Math.min(...xs) - 50) / 100) * 100, xMax = Math.ceil((Math.max(...xs) + 50) / 100) * 100;
  const yMin = Math.log10(1), yMax = Math.log10(300);
  const X = (pr: number) => L + ((pr - xMin) / Math.max(1, xMax - xMin)) * (W - L - R);
  const Y = (ms: number) => T + (1 - (Math.min(yMax, Math.max(yMin, Math.log10(ms / 1000))) - yMin) / (yMax - yMin)) * (H - T - B);
  const yTicks = [1, 3, 10, 30, 100, 300];
  const xTicks: number[] = []; for (let v = xMin; v <= xMax; v += (xMax - xMin > 1200 ? 400 : 200)) xTicks.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Solve time against puzzle rating">
      {yTicks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={Y(t * 1000)} y2={Y(t * 1000)} stroke="currentColor" className="text-ink-800" strokeDasharray={t === 5 ? "3 3" : undefined} /><text x={L - 6} y={Y(t * 1000) + 3} textAnchor="end" fontSize="9" className="fill-ink-500">{t}s</text></g>)}
      <line x1={L} x2={W - R} y1={Y(5000)} y2={Y(5000)} stroke="#fb7185" strokeDasharray="4 3" strokeOpacity="0.6" />
      <text x={W - R} y={Y(5000) - 3} textAnchor="end" fontSize="9" fill="#fb7185">5 s floor</text>
      {xTicks.map((t) => <text key={t} x={X(t)} y={H - 10} textAnchor="middle" fontSize="9" className="fill-ink-500">{t}</text>)}
      <text x={W - R} y={H - 1} textAnchor="end" fontSize="8" className="fill-ink-600">puzzle rating →</text>
      {pts.map((p, i) => {
        const cx = X(p.pr), cy = Y(p.ms!);
        const ring = p.dub ? "#fb7185" : p.held ? "#fbbf24" : null;
        return (
          <g key={i}>
            {ring && <circle cx={cx} cy={cy} r={5.5} fill="none" stroke={ring} strokeWidth={1.5} />}
            <circle cx={cx} cy={cy} r={3} fill={p.w ? "#2dd4bf" : "none"} stroke={p.w ? "#2dd4bf" : "#6b7280"} strokeWidth={1} fillOpacity={0.85}>
              <title>{`${p.pr} · ${p.w ? "win" : "loss"} · ${secs(p.ms!)}${p.crowdMedMs ? ` · crowd ${secs(p.crowdMedMs)}` : ""}${p.dubr?.length ? ` · ${p.dubr.join(", ")}` : ""}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

/** Rhythm: the per-move gaps of the fastest 2400+ wins. Engines are flat. */
function Rhythm({ fastest }: { fastest: Detail["evidence"]["fastest"] }) {
  const rows = fastest.filter((f) => f.mvMs && f.mvMs.length > 0);
  if (!rows.length) return <div className="text-xs text-ink-500">No per-move timing on the fastest hard wins.</div>;
  return (
    <div className="space-y-1.5">
      {rows.map((f) => {
        const total = f.mvMs!.reduce((a, b) => a + b, 0) || 1;
        return (
          <div key={f.pid + f.at} className="flex items-center gap-2 text-[11px]">
            <Link to={`/puzzles?review=${encodeURIComponent(f.pid)}`} className="w-24 shrink-0 font-mono text-ink-200 hover:underline">{f.pr} · {secs(f.ms)}</Link>
            <div className="flex h-4 flex-1 overflow-hidden rounded bg-ink-800">
              {f.mvMs!.map((m, i) => (
                <div key={i} className={`flex items-center justify-center border-r border-ink-900 ${i === 0 ? "bg-sky-500/50" : "bg-teal-500/50"}`} style={{ width: `${(m / total) * 100}%` }} title={`${i === 0 ? "first move" : `gap ${i}`}: ${secs(m)}`}>
                  <span className="truncate px-0.5 text-[9px] text-white/90">{(m / 1000).toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Sessions: solves per day across the window, wins filled, losses dim. */
function Timeline({ sessions, peakHour }: { sessions: Detail["evidence"]["sessions"]; peakHour: Detail["evidence"]["peakHour"] }) {
  if (!sessions.length) return null;
  const max = Math.max(...sessions.map((s) => s.solves));
  return (
    <div>
      <div className="flex h-20 items-end gap-[3px]">
        {sessions.map((s) => (
          <div key={s.day} className="flex h-full flex-1 flex-col justify-end" title={`${s.day}: ${s.solves} solves, ${s.wins} wins`}>
            <div className="w-full rounded-t bg-ink-700" style={{ height: `${((s.solves - s.wins) / max) * 100}%` }} />
            <div className="w-full bg-teal-500/70" style={{ height: `${(s.wins / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-500"><span>{day(sessions[0]!.day)}</span><span>{sessions.length} active days{peakHour ? ` · busiest hour ${peakHour.solves} solves (${new Date(peakHour.hour + ":00:00Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric" })})` : ""}</span><span>{day(sessions[sessions.length - 1]!.day)}</span></div>
    </div>
  );
}

function Drawer({ userId, isOwner, busy, onClose, onReset, onDecide }: { userId: string; isOwner: boolean; busy: string | null; onClose: () => void; onReset: (r: { userId: string; name: string }) => void; onDecide: (a: Actor, kind: "clear" | "hold") => void }) {
  const q = useQuery({ queryKey: ["academy-suspicious-detail", userId], queryFn: () => get<Detail>(`/api/academy/suspicious-solves/${encodeURIComponent(userId)}`), staleTime: 60_000 });
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const d = q.data;
  const c = d?.components;
  const e = d?.evidence;
  const lines: { label: string; pts: number; note: string }[] = c && e ? [
    { label: "Flagged solves", pts: c.flags, note: e.flagged ? `${e.flagged} flagged · ${Object.entries(e.reasons).map(([k, n]) => `${REASON_LABEL[k] ?? k} × ${n}`).join(", ")}` : "none" },
    { label: "Fast hard wins", pts: c.fastHard, note: `${e.hard.fast} wins on 2400+ under 5 s (of ${e.hard.wins} wins, ${e.hard.n} tries)` },
    { label: "Accuracy curve", pts: c.accuracy, note: `${pctStr(e.above.winPct)} on puzzles 200+ above (${e.above.n}) vs ${pctStr(e.atLevel.winPct)} at level (${e.atLevel.n})${e.hard.winPct !== null ? ` · ${e.hard.winPct}% on 2400+` : ""}` },
    { label: "Crowd baseline", pts: c.crowd, note: e.crowdRatio === null ? "not enough overlap with the crowd yet" : `typical win takes ${Math.round(e.crowdRatio * 100)}% of the crowd's time on the same puzzles` },
    { label: "Climb", pts: c.climb, note: e.ratingStart !== null ? `${e.ratingStart} → ${e.ratingEnd} (${e.climb > 0 ? "+" : ""}${e.climb})` : "—" },
    { label: "Theme spread", pts: c.themeFlat ?? 0, note: e.themes ? `${e.themes.n} themes with 20+ solves, rated ${e.themes.min}–${e.themes.max} (spread ±${e.themes.sd})${e.themes.n < 8 ? " · needs 8 themes to count" : ""}` : "no theme with 20+ solves yet" },
    { label: "Play cross-check", pts: c.playGap ?? 0, note: e.play ? `${e.play.speed} ${e.play.r} over ${e.play.nb} games · puzzle rating ${e.play.gap > 0 ? "+" : ""}${e.play.gap} against it` : "no rated live games yet" },
  ] : [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose} data-testid="suspicious-detail">
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-ink-700 bg-ink-950 p-4 shadow-2xl sm:p-5" onClick={(ev) => ev.stopPropagation()}>
        {q.isLoading || !d ? <div className="h-40 animate-pulse rounded-lg bg-ink-800/60" /> : !d.ok ? <div className="text-sm text-rose-200">{d.error}</div> : (
          <>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-xl text-white">{d.name}</h3>
                  <BandPill band={d.band} hold={d.hold} />
                </div>
                <p className="mt-1 text-xs text-ink-400">Fair-play score <b className="text-white">{d.score}</b>/100 · window since {day(d.windowStart)}{d.lastReset ? ` (last reset ${day(d.lastReset)})` : ""} · {e!.solves} solves</p>
                <p className="mt-0.5 text-[11px] text-ink-500">{d.modelActive ? `Fitted model ${d.modelScore} (in use) · hand weights ${d.handScore}` : `Hand weights ${d.handScore} (in use) · fitted model ${d.modelScore} (shadow)`}</p>
                {d.hold && <p className="mt-1 text-xs text-amber-200">Rated gains are held until {isOwner ? "you reset or clear" : "the owner resets or clears"} this student. The student has not been told.</p>}
                {d.decision && <div className="mt-1.5"><DecisionChip d={d.decision} /></div>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DecisionButtons a={{ userId: d.userId, name: d.name, hold: d.hold }} busy={busy} onDecide={onDecide} />
                {isOwner && <button onClick={() => onReset({ userId: d.userId, name: d.name })} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20" data-testid="reset-rating">Reset rating…</button>}
                <button onClick={onClose} className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:text-white" aria-label="Close">✕</button>
              </div>
            </div>
            <section className="mb-4 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Score breakdown</h4>
              <div className="space-y-1.5">
                {lines.map((l) => (
                  <div key={l.label} className="flex items-start gap-3 text-xs">
                    <span className={`w-8 shrink-0 text-right font-mono ${l.pts > 0 ? "text-rose-200" : "text-ink-600"}`}>+{l.pts}</span>
                    <span className="w-28 shrink-0 text-ink-200">{l.label}</span>
                    <span className="text-ink-400">{l.note}</span>
                  </div>
                ))}
                <div className="flex items-start gap-3 border-t border-ink-800 pt-1.5 text-xs"><span className="w-8 shrink-0 text-right font-mono text-white">{d.score}</span><span className="text-ink-300">total · Watch at 25 · Review at 60</span></div>
              </div>
            </section>
            <section className="mb-4 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Speed vs difficulty</h4>
              <p className="mb-2 text-[11px] text-ink-500">Teal = win, hollow = loss, red ring = flagged, amber ring = held. Honest solving gets slower as puzzles get harder.</p>
              <Scatter solves={d.solves} />
            </section>
            <section className="mb-4 rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Rhythm of the fastest 2400+ wins</h4>
              <p className="mb-2 text-[11px] text-ink-500">Blue = time to the first move, teal = gaps between moves. Flat 1–2 s gaps on hard puzzles are the engine's rhythm, not a human's.</p>
              <Rhythm fastest={e!.fastest} />
            </section>
            <section className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Sessions</h4>
              <Timeline sessions={e!.sessions} peakHour={e!.peakHour} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcademySuspiciousPanel({ isOwner, compact = false }: { isOwner: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const qc = useQueryClient();
  const [showRecent, setShowRecent] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const q = useQuery({
    queryKey: ["academy-suspicious"],
    queryFn: () => get<{ days: number; students: Row[]; recent: Recent[]; model: ModelStatus }>(`/api/academy/suspicious-solves`),
    staleTime: 60_000,
  });
  const rows = q.data?.students ?? [];
  const recent = q.data?.recent ?? [];
  const model = q.data?.model;
  if (compact && (!q.data || rows.length === 0)) return null;

  const decide = async (a: Actor, kind: "clear" | "hold") => {
    const note = window.prompt(kind === "clear"
      ? `Clear ${a.name}? Add a note for the record (why you're satisfied this was honest). Their window restarts and they drop off the list.`
      : `Hold ${a.name}'s rated gains? Add a note for the record. Gains stop until the owner resets or clears. The student is not told.`,
      kind === "clear" ? "Watched them solve in class — genuine" : "Pattern matches assisted solving — see drawer");
    if (note === null) return;
    setBusy(a.userId);
    try {
      const res = await post<{ ok: boolean; error?: string }>(`/api/academy/suspicious-solves/${encodeURIComponent(a.userId)}/${kind}`, { note });
      if (res.ok) { setToast(kind === "clear" ? `${a.name} cleared.` : `${a.name}: rated gains on hold.`); setOpen(null); void qc.invalidateQueries({ queryKey: ["academy-suspicious"] }); void qc.invalidateQueries({ queryKey: ["academy-suspicious-detail"] }); }
      else setToast(res.error || "Could not save that.");
    } catch (e: any) { setToast(e?.message || "Could not save that."); }
    finally { setBusy(null); setTimeout(() => setToast(null), 5000); }
  };

  const reset = async (r: { userId: string; name: string }) => {
    const ratingStr = window.prompt(`Reset ${r.name}'s puzzle rating to:`, "1700");
    if (ratingStr === null) return;
    const rating = Math.round(Number(ratingStr));
    if (!isFinite(rating) || rating < 400 || rating > 3000) { setToast("Enter a rating between 400 and 3000."); return; }
    const reason = window.prompt("Reason (kept in the audit log):", "Fair play review — see the Suspicious solving panel") ?? "";
    if (!window.confirm(`Set ${r.name} to ${rating}? Per-theme ratings above ${rating} are clamped too, the hold lifts, and the fair-play window restarts. This is logged.`)) return;
    setBusy(r.userId);
    try {
      const res = await post<{ ok: boolean; error?: string; before?: { r: number } | null }>(`/api/academy/students/${encodeURIComponent(r.userId)}/reset-puzzle-rating`, { rating, reason });
      if (res.ok) { setToast(`${r.name}: ${res.before?.r ?? "?"} → ${rating}`); setOpen(null); void qc.invalidateQueries({ queryKey: ["academy-suspicious"] }); void qc.invalidateQueries({ queryKey: ["academy-suspicious-detail"] }); }
      else setToast(res.error || "Could not reset.");
    } catch (e: any) { setToast(e?.message || "Could not reset."); }
    finally { setBusy(null); setTimeout(() => setToast(null), 4000); }
  };

  const reviewN = rows.filter((r) => r.band === "review").length;
  return (
    <section className="rounded-xl2 border border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-ink-900 to-ink-900 p-4" data-testid="suspicious-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg text-white">🚩 Suspicious solving</h2>
          <p className="text-xs text-ink-400">Fair-play score over the last 30 days (or since a reset): flagged solves, wins on 2400+ puzzles under 5 s, an inverted accuracy curve, speed against the crowd, steep climbs. <b className="text-amber-200">Watch</b> from 25, <b className="text-rose-200">Review</b> from 60 — Review holds rated gains until {isOwner ? "you reset or clear" : "the owner resets or clears"}. <b className="text-emerald-200">Clear</b> a student with a note when you're satisfied, or <b className="text-amber-200">Hold</b> their gains yourself. Students are not told.</p>
        </div>
        {rows.length > 0 && <span className="text-[11px] text-ink-400">{reviewN} in review · {rows.length - reviewN} on watch</span>}
      </div>
      {model && (
        <p className="mb-3 text-[11px] text-ink-500" data-testid="model-status" title={model.cv.accuracy !== null ? `leave-one-out: ${model.cv.correct}/${model.cv.total} right, ${model.cv.falseAlarms} false alarms, ${model.cv.missed} missed` : undefined}>
          🧠 Learning from your decisions: <span className={model.active ? "text-emerald-200" : "text-ink-300"}>{model.reason}</span>{model.active ? " — the fitted model now sets the bands." : " — hand weights set the bands; the model scores in the background."}
        </p>
      )}
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-lg bg-ink-800/60" />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">Everyone is clear.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.userId} className={`rounded-xl border p-3 ${r.band === "review" ? "border-rose-500/40 bg-rose-500/5" : "border-ink-700/70 bg-ink-900/70"}`} data-testid="suspicious-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/insights/students/${encodeURIComponent(r.userId)}`} className="font-semibold text-white hover:underline">{r.name}</Link>
                  <BandPill band={r.band} hold={r.hold} />
                  <span className="rounded-md bg-ink-800 px-1.5 py-0.5 text-xs text-ink-200">now {r.ratingNow ?? "—"}</span>
                  {r.climb !== 0 && (
                    <span className={`rounded-md px-1.5 py-0.5 text-xs ${r.climb >= 500 ? "bg-rose-500/20 text-rose-200" : "bg-ink-800 text-ink-300"}`}>{r.ratingStart} → {r.ratingEnd} ({r.climb > 0 ? "+" : ""}{r.climb})</span>
                  )}
                  {r.dubious > 0 && <span className="rounded-md bg-rose-500/25 px-1.5 py-0.5 text-xs font-semibold text-rose-100">{r.dubious} flagged</span>}
                  {r.lastReset && !r.decision && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-200">reset {day(r.lastReset.at)}</span>}
                  <DecisionChip d={r.decision} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ScoreBar score={r.score} />
                  {r.modelScore !== r.score && <span className="font-mono text-[10px] text-ink-500" title="What the fitted model would score (shadow)">model {r.modelScore}</span>}
                  <button onClick={() => setOpen(r.userId)} className="rounded-lg border border-ink-700 bg-ink-800/60 px-2.5 py-1 text-xs font-semibold text-ink-100 hover:bg-ink-700" data-testid="open-detail">Details</button>
                  <DecisionButtons a={{ userId: r.userId, name: r.name, hold: r.hold }} busy={busy} onDecide={decide} />
                  {isOwner && (
                    <button onClick={() => reset(r)} disabled={busy === r.userId} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-50" data-testid="reset-rating">
                      {busy === r.userId ? "…" : "Reset rating…"}
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
                <span>{r.solves} solves</span>
                {r.hard.n > 0 && <span>2400+ puzzles: <b className="text-white">{r.hard.winPct}%</b> of {r.hard.n}{r.hard.medianMs !== null ? <> · median <b className="text-white">{secs(r.hard.medianMs)}</b></> : null}{r.hard.fast > 0 ? <> · <b className="text-rose-200">{r.hard.fast}</b> under 5 s</> : null}</span>}
                {r.crowdRatio !== null && <span>vs crowd: <b className={r.crowdRatio < 0.4 ? "text-rose-200" : "text-white"}>{Math.round(r.crowdRatio * 100)}%</b> of typical time</span>}
                {Object.entries(r.reasons).map(([k, n]) => (
                  <span key={k} className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-100">{REASON_LABEL[k] ?? k} × {n}</span>
                ))}
              </div>
              {r.fastest.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.fastest.map((f) => (
                    <Link key={f.puzzleId} to={`/puzzles?review=${encodeURIComponent(f.puzzleId)}`} title={f.mvMs ? `per move: ${f.mvMs.map((m) => (m / 1000).toFixed(1) + "s").join(" · ")}` : undefined}
                      className="rounded-md bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-ink-100 hover:bg-ink-700">
                      {f.pr} in {secs(f.ms)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-3 border-t border-ink-800 pt-2" data-testid="recent-decisions">
          <button onClick={() => setShowRecent((v) => !v)} className="text-xs text-ink-400 hover:underline">{showRecent ? "▾" : "▸"} Recent decisions ({recent.length})</button>
          {showRecent && (
            <ul className="mt-2 space-y-1">
              {recent.map((e, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-300">
                  <span className="text-ink-500">{day(e.at)}</span>
                  <span className={e.kind === "clear" ? "text-emerald-200" : e.kind === "review" ? "text-rose-200" : "text-amber-200"}>{KIND_LABEL[e.kind]}</span>
                  <Link to={`/insights/students/${encodeURIComponent(e.userId)}`} className="font-semibold text-white hover:underline">{e.name}</Link>
                  {e.byName && <span className="text-ink-500">by {e.byName}</span>}
                  {e.score !== null && <span className="font-mono text-ink-500">score {e.score}</span>}
                  {e.note && <span className="text-ink-400">“{e.note}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className={recent.length > 0 ? "mt-2" : "mt-3 border-t border-ink-800 pt-2"}>
        <button onClick={() => setShowReport((v) => !v)} className="text-xs text-ink-400 hover:underline" data-testid="toggle-report">{showReport ? "▾" : "▸"} Fairness report</button>
        <Link to="/academy/fairness" className="ml-3 text-xs text-brand-300 hover:underline" data-testid="full-report">Full report →</Link>
        {showReport && <FairnessReport />}
      </div>
      {toast && <div className="mt-3 rounded-lg bg-ink-800 px-3 py-2 text-sm text-white">{toast}</div>}
      {open && <Drawer userId={open} isOwner={isOwner} busy={busy} onClose={() => setOpen(null)} onReset={reset} onDecide={decide} />}
    </section>
  );
}
