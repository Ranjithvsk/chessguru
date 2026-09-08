// Fairness report — the coach-facing account of a month of fair play:
// every incident with its timeline, daily score, evidence and a plain-words
// "how it was detected"; what the engine did across the roster; exam and
// homework proctoring; the health of the signals; and how detection works.
// Backed by GET /api/academy/fairplay-report/detail?month=YYYY-MM. Coaches
// see their own students; the owner sees the academy. Printable.
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

type Band = "clear" | "watch" | "review";
interface Person { userId: string; name: string }
interface Rule { rule: string; label: string; meaning: string; solves: number; students: number }
interface Incident {
  userId: string; name: string; bandNow: Band; scoreNow: number; hold: boolean; ratingNow: number | null;
  timeline: { at: string; kind: string; label: string; detail?: string }[];
  daily: { day: string; score: number; band: Band }[];
  peak: { day: string; score: number; band: Band; components: Record<string, number>; hard: { n: number; wins: number; winPct: number | null; medianMs: number | null; fast: number }; atLevel: { n: number; winPct: number | null }; above: { n: number; winPct: number | null }; crowdRatio: number | null; ratingStart: number | null; ratingEnd: number | null; fastest: { pid: string; pr: number; ms: number; mvMs: number[] | null; at: string }[] } | null;
  flagged: { count: number; stored: number; wins: number; reasons: Record<string, number>; samples: { pid: string; pr: number; ms: number | null; mvMs: number[] | null; dubr: string[]; at: string; w: boolean; replayed: boolean }[] };
  held: number; focusLoss: number; solves: number;
  exams: { examId: string; title: string; at: string; hiddenCount: number; hiddenMs: number; fsExits: number; scorePct: number }[];
  howDetected: string[]; whatEngineDid: string[];
  decision: { kind: string; by: string; byName?: string; note: string; at: string } | null;
  timeToReviewHours: number | null;
}
interface Detail {
  month: string; academyName: string; scope: "academy" | "roster"; generatedAt: string;
  solves: number; flagged: number; activeStudents: number; students: number;
  listed: Person[]; falseAlarms: Person[]; falseAlarmsPer500: number | null; catches: Person[]; reviews: number;
  timeToReviewHours: { median: number | null; n: number; all: number[] };
  decisions: { clear: number; hold: number; reset: number };
  acceptance: { falseAlarms: boolean | null; timeToReview: boolean | null };
  incidents: Incident[];
  detection: { rules: Rule[]; flaggedSolves: number; heldWins: number; focusLossSolves: number; drillsExcused: number; fastSolves: number };
  exams: { proctoredAttempts: number; clean: number; left: number; incidents: (Person & { title: string; at: string; hiddenCount: number; hiddenMs: number; fsExits: number; scorePct: number })[] };
  homework: (Person & { solves: number; focusLoss: number; hiddenMs: number })[];
  health: { crowd: { puzzlesWithStats: number; monthPuzzles: number; coveredPct: number | null; bands: { band: number; medMs: number }[] }; model: { active: boolean; reason: string; n: { assisted: number; honest: number }; cv: { accuracy: number | null; correct: number; total: number; falseAlarms: number; missed: number } }; disagreements: (Person & { hand: number; model: number })[] };
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
const day = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const when = (s: string) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const secs = (ms: number | null) => (ms === null ? "—" : (ms / 1000).toFixed(1) + " s");
const names = (xs: Person[]) => (xs.length ? xs.map((x) => x.name).join(", ") : "none");
const bandCls: Record<Band, string> = { review: "bg-rose-500/25 text-rose-100", watch: "bg-amber-500/20 text-amber-100", clear: "bg-emerald-500/15 text-emerald-100" };
const bandWord: Record<Band, string> = { review: "Review", watch: "Watch", clear: "Clear" };
const KIND_ICON: Record<string, string> = { first_flag: "🚩", watch: "👀", review: "⛔", notified: "✉️", hold: "✋", clear: "✅", reset: "↩️" };

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const ring = tone === "bad" ? "border-rose-500/40" : tone === "warn" ? "border-amber-500/40" : tone === "good" ? "border-emerald-500/40" : "border-ink-800";
  return (
    <div className={`rounded-xl border ${ring} bg-ink-900/60 px-3 py-2.5`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-0.5 font-display text-xl text-white">{value}</div>
      {sub && <div className="text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

function Spark({ daily }: { daily: Incident["daily"] }) {
  if (daily.length < 2) return null;
  const W = 260, H = 56, L = 4, R = 4, T = 4, B = 4;
  const X = (i: number) => L + (i / (daily.length - 1)) * (W - L - R);
  const Y = (s: number) => T + (1 - s / 100) * (H - T - B);
  const path = daily.map((d, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(d.score).toFixed(1)}`).join(" ");
  const last = daily[daily.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full max-w-[260px]" role="img" aria-label="Daily fair-play score">
      <line x1={L} x2={W - R} y1={Y(60)} y2={Y(60)} stroke="#fb7185" strokeDasharray="3 3" strokeOpacity="0.7" />
      <line x1={L} x2={W - R} y1={Y(25)} y2={Y(25)} stroke="#fbbf24" strokeDasharray="3 3" strokeOpacity="0.7" />
      <path d={path} fill="none" stroke="#5eead4" strokeWidth={1.8} />
      <circle cx={X(daily.length - 1)} cy={Y(last.score)} r={3} fill={last.band === "review" ? "#fb7185" : last.band === "watch" ? "#fbbf24" : "#34d399"} />
      <text x={L} y={H - 1} fontSize="8" className="fill-ink-500">{day(daily[0]!.day)}</text>
      <text x={W - R} y={H - 1} fontSize="8" textAnchor="end" className="fill-ink-500">{day(last.day)} · {last.score}</text>
    </svg>
  );
}

function IncidentCard({ inc, ruleLabel }: { inc: Incident; ruleLabel: (r: string) => string }) {
  const p = inc.peak;
  return (
    <article className="rounded-2xl border border-ink-800 bg-ink-900/60 p-4 print:break-inside-avoid" data-testid="incident">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/insights/students/${encodeURIComponent(inc.userId)}`} className="font-display text-lg text-white hover:underline">{inc.name}</Link>
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${bandCls[inc.bandNow]}`}>now {bandWord[inc.bandNow]}{inc.hold ? " · gains held" : ""}</span>
            {inc.ratingNow !== null && <span className="rounded-md bg-ink-800 px-1.5 py-0.5 text-xs text-ink-200">rating {inc.ratingNow}</span>}
            {p && <span className="rounded-md bg-ink-800 px-1.5 py-0.5 text-xs text-ink-300">peak {p.score} on {day(p.day)}</span>}
          </div>
          <div className="mt-1 text-[11px] text-ink-500">{inc.solves} solves this month · {inc.flagged.count} flagged · {inc.held} held · {inc.focusLoss} left the tab{inc.timeToReviewHours !== null ? ` · Review ${inc.timeToReviewHours} h after the first flag` : ""}</div>
        </div>
        <Spark daily={inc.daily} />
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Timeline</h4>
          {inc.timeline.length === 0 ? <p className="text-xs text-ink-500">No events this month — listed on the current score only.</p> : (
            <ol className="space-y-1.5">
              {inc.timeline.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className="w-5 shrink-0 text-center">{KIND_ICON[t.kind] ?? "•"}</span>
                  <span className="w-24 shrink-0 font-mono text-ink-500">{when(t.at)}</span>
                  <span className="text-ink-200">{t.label}{t.detail ? <span className="text-ink-500"> — {t.detail}</span> : null}</span>
                </li>
              ))}
            </ol>
          )}
          {inc.decision && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${inc.decision.kind === "clear" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100" : "border-amber-500/30 bg-amber-500/5 text-amber-100"}`}>
              <b>{inc.decision.kind === "clear" ? "Cleared" : inc.decision.kind === "hold" ? "Held" : "Reset"}</b> by {inc.decision.byName || inc.decision.by} on {day(inc.decision.at)}{inc.decision.note ? <> — “{inc.decision.note}”</> : null}
            </div>
          )}
        </section>
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">How it was detected</h4>
          <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-ink-200">
            {inc.howDetected.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
          <h4 className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-400">What the engine did</h4>
          <ul className="space-y-1 text-xs text-ink-300">
            {inc.whatEngineDid.map((l, i) => <li key={i}>• {l}</li>)}
          </ul>
        </section>
      </div>

      {(inc.flagged.samples.length > 0 || (p && p.fastest.length > 0)) && (
        <section className="mt-4">
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Evidence — open any puzzle to replay it</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-ink-500"><tr><th className="py-1 pr-3 text-left">When</th><th className="py-1 pr-3 text-left">Puzzle</th><th className="py-1 pr-3 text-right">Rated</th><th className="py-1 pr-3 text-right">Time</th><th className="py-1 pr-3 text-left">Per move</th><th className="py-1 text-left">Rule</th></tr></thead>
              <tbody>
                {inc.flagged.samples.map((x, i) => (
                  <tr key={"f" + i} className="border-t border-ink-800/60">
                    <td className="py-1 pr-3 font-mono text-ink-500">{when(x.at)}</td>
                    <td className="py-1 pr-3"><Link to={`/puzzles?review=${encodeURIComponent(x.pid)}`} className="font-mono text-brand-300 hover:underline">{x.pid}</Link>{x.w ? "" : <span className="text-ink-600"> (lost)</span>}</td>
                    <td className="py-1 pr-3 text-right text-ink-200">{x.pr}</td>
                    <td className="py-1 pr-3 text-right text-ink-200">{secs(x.ms)}</td>
                    <td className="py-1 pr-3 font-mono text-ink-400">{x.mvMs ? x.mvMs.map((m) => (m / 1000).toFixed(1)).join(" · ") : "—"}</td>
                    <td className="py-1 text-rose-200">{x.dubr.map(ruleLabel).join(", ")}{x.replayed ? <span className="text-ink-600"> · replayed</span> : null}</td>
                  </tr>
                ))}
                {p && p.fastest.filter((f) => !inc.flagged.samples.some((s) => s.pid === f.pid)).map((f, i) => (
                  <tr key={"p" + i} className="border-t border-ink-800/60">
                    <td className="py-1 pr-3 font-mono text-ink-500">{when(f.at)}</td>
                    <td className="py-1 pr-3"><Link to={`/puzzles?review=${encodeURIComponent(f.pid)}`} className="font-mono text-brand-300 hover:underline">{f.pid}</Link></td>
                    <td className="py-1 pr-3 text-right text-ink-200">{f.pr}</td>
                    <td className="py-1 pr-3 text-right text-ink-200">{secs(f.ms)}</td>
                    <td className="py-1 pr-3 font-mono text-ink-400">{f.mvMs ? f.mvMs.map((m) => (m / 1000).toFixed(1)).join(" · ") : "—"}</td>
                    <td className="py-1 text-ink-500">fast hard win</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {inc.exams.length > 0 && (
        <section className="mt-3 text-xs text-ink-300">
          <span className="font-semibold text-ink-400">Proctored exams: </span>
          {inc.exams.map((e, i) => <span key={i}>{i ? " · " : ""}{e.title} on {day(e.at)}: left {e.hiddenCount}× for {Math.round(e.hiddenMs / 1000)} s{e.fsExits ? `, full screen exited ${e.fsExits}×` : ""} (scored {e.scorePct}%)</span>)}
        </section>
      )}
    </article>
  );
}

export default function AcademyFairnessPage() {
  const [sp, setSp] = useSearchParams();
  const now = new Date();
  const months = useMemo(() => [0, 1, 2, 3, 4, 5].map((i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)))), []);
  const month = sp.get("month") && /^\d{4}-\d{2}$/.test(sp.get("month")!) ? sp.get("month")! : months[0]!;
  const q = useQuery({ queryKey: ["academy-fairness-detail", month], queryFn: () => get<Detail>(`/api/academy/fairplay-report/detail?month=${month}`), staleTime: 5 * 60_000 });
  const r = q.data;

  return (
    <div className="mx-auto max-w-6xl px-3 py-6 print:max-w-none">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-300">Academy · Fair play</div>
          <h1 className="font-display text-2xl text-white">Fairness report{r ? ` — ${r.academyName}` : ""}</h1>
          <p className="text-xs text-ink-400">{r?.scope === "roster" ? "Your students only." : "Whole academy."} Every incident, how the engine saw it, and what it did. Students are never shown any of this.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-full border border-ink-700 bg-ink-900 p-0.5 text-[11px]">
            {months.map((m) => <button key={m} onClick={() => setSp({ month: m })} className={`rounded-full px-2.5 py-0.5 ${month === m ? "bg-ink-700 text-white" : "text-ink-400 hover:underline"}`}>{monthLabel(m)}</button>)}
          </div>
          <button onClick={() => window.print()} className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:text-white">Print</button>
          <Link to="/academy/performance" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:text-white">← Student performance</Link>
        </div>
      </div>
      <div className="mb-3 hidden print:block"><h1 className="text-2xl font-bold">Fairness report — {r?.academyName} — {monthLabel(month)}</h1></div>

      {q.isLoading || !r ? <div className="h-40 animate-pulse rounded-xl bg-ink-800/60" /> : q.error ? <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{String((q.error as any)?.message)}</div> : (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" data-testid="glance">
            <Tile label="Solves" value={String(r.solves)} sub={`${r.activeStudents} of ${r.students} students`} />
            <Tile label="Flagged solves" value={String(r.detection.flaggedSolves)} sub="no rating given" tone={r.detection.flaggedSolves ? "warn" : undefined} />
            <Tile label="Put on the list" value={String(r.listed.length)} sub={names(r.listed)} />
            <Tile label="False alarms" value={r.falseAlarmsPer500 === null ? "—" : `${r.falseAlarmsPer500}`} sub={`per 500 solves · target < 1 · ${r.falseAlarms.length} student${r.falseAlarms.length === 1 ? "" : "s"}`} tone={r.acceptance.falseAlarms === false ? "bad" : r.acceptance.falseAlarms ? "good" : undefined} />
            <Tile label="Catches" value={String(r.catches.length)} sub={names(r.catches)} tone={r.catches.length ? "warn" : undefined} />
            <Tile label="Time to Review" value={r.timeToReviewHours.median === null ? "—" : `${r.timeToReviewHours.median} h`} sub={r.timeToReviewHours.n ? `median of ${r.timeToReviewHours.n} · target < 24 h` : "no Review this month"} tone={r.acceptance.timeToReview === false ? "bad" : r.acceptance.timeToReview ? "good" : undefined} />
            <Tile label="Held wins" value={String(r.detection.heldWins)} sub="while in Review" tone={r.detection.heldWins ? "warn" : undefined} />
            <Tile label="Decisions" value={String(r.decisions.clear + r.decisions.hold + r.decisions.reset)} sub={`${r.decisions.clear} cleared · ${r.decisions.hold} held · ${r.decisions.reset} reset`} />
          </section>

          <h2 className="mb-2 mt-7 font-display text-lg text-white">Incidents <span className="text-sm text-ink-500">({r.incidents.length})</span></h2>
          {r.incidents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-700 px-4 py-6 text-center text-sm text-ink-400">No student was listed, held, cleared or reset in {monthLabel(month)}.</div>
          ) : (
            <div className="space-y-3">{r.incidents.map((inc) => <IncidentCard key={inc.userId} inc={inc} ruleLabel={(k) => r.detection.rules.find((x) => x.rule === k)?.label ?? k} />)}</div>
          )}

          <h2 className="mb-2 mt-7 font-display text-lg text-white">What the engine did this month</h2>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="overflow-x-auto rounded-xl border border-ink-800 bg-ink-900/60">
              <table className="w-full text-xs">
                <thead className="bg-ink-800/60 text-[10px] uppercase tracking-wide text-ink-500"><tr><th className="px-3 py-2 text-left">Live rule</th><th className="px-3 py-2 text-left">What it means</th><th className="px-3 py-2 text-right">Solves</th><th className="px-3 py-2 text-right">Students</th></tr></thead>
                <tbody>
                  {r.detection.rules.map((x) => (
                    <tr key={x.rule} className="border-t border-ink-800/60">
                      <td className="px-3 py-1.5 font-semibold text-ink-100">{x.label}</td>
                      <td className="px-3 py-1.5 text-ink-400">{x.meaning}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${x.solves ? "text-rose-200" : "text-ink-600"}`}>{x.solves}</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${x.students ? "text-rose-200" : "text-ink-600"}`}>{x.students}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Tile label="Fast solves on 2000+" value={String(r.detection.fastSolves)} sub="wins under 4 s" />
              <Tile label="Excused as drills" value={String(r.detection.drillsExcused)} sub="one-move or mate-theme practice — never counted" tone="good" />
              <Tile label="Left the tab" value={String(r.detection.focusLossSolves)} sub="solves where the trainer lost focus" />
              <Tile label="Held wins" value={String(r.detection.heldWins)} sub="Review band, no rating" />
            </div>
          </div>

          <h2 className="mb-2 mt-7 font-display text-lg text-white">Exams and homework</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <div className="mb-2 text-xs text-ink-300"><b className="text-white">{r.exams.proctoredAttempts}</b> proctored exam attempts · <b className="text-emerald-200">{r.exams.clean}</b> clean · <b className={r.exams.left ? "text-amber-200" : "text-ink-300"}>{r.exams.left}</b> left the exam</div>
              {r.exams.incidents.length === 0 ? <p className="text-xs text-ink-500">Nobody left a proctored exam.</p> : (
                <ul className="space-y-1 text-xs text-ink-200">
                  {r.exams.incidents.map((e, i) => <li key={i}><b>{e.name}</b> — {e.title}, {day(e.at)}: left {e.hiddenCount}× for {Math.round(e.hiddenMs / 1000)} s{e.fsExits ? `, full screen exited ${e.fsExits}×` : ""} · scored {e.scorePct}%</li>)}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <div className="mb-2 text-xs text-ink-300">Homework solves that lost focus</div>
              {r.homework.filter((h) => h.focusLoss > 0).length === 0 ? <p className="text-xs text-ink-500">{r.homework.length ? `${r.homework.reduce((s, h) => s + h.solves, 0)} homework solves, focus kept on all of them.` : "No homework solves recorded this month."}</p> : (
                <ul className="space-y-1 text-xs text-ink-200">
                  {r.homework.filter((h) => h.focusLoss > 0).map((h) => <li key={h.userId}><b>{h.name}</b> — {h.focusLoss} of {h.solves} solves, {Math.round(h.hiddenMs / 1000)} s away in total</li>)}
                </ul>
              )}
            </div>
          </div>

          <h2 className="mb-2 mt-7 font-display text-lg text-white">Signal health</h2>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3 text-xs text-ink-300">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Crowd baseline</div>
              <p>{r.health.crowd.puzzlesWithStats} puzzles have a typical solve time. {r.health.crowd.coveredPct === null ? "" : `${r.health.crowd.coveredPct}% of the puzzles solved this month had one from 5+ solvers; the rest fall back to the rating band.`}</p>
              <table className="mt-2 w-full font-mono text-[11px]"><tbody>
                {r.health.crowd.bands.filter((b) => b.band >= 1600).map((b) => <tr key={b.band}><td className="text-ink-500">{b.band}</td><td className="text-right text-ink-200">{(b.medMs / 1000).toFixed(0)} s</td></tr>)}
              </tbody></table>
            </div>
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3 text-xs text-ink-300">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Learning from decisions</div>
              <p>{r.health.model.reason}.</p>
              <p className="mt-1">{r.health.model.n.assisted} assisted and {r.health.model.n.honest} honest decisions so far{r.health.model.cv.accuracy !== null ? ` · leave-one-out replay ${r.health.model.cv.correct}/${r.health.model.cv.total} right (${r.health.model.cv.falseAlarms} false alarms, ${r.health.model.cv.missed} missed)` : ""}.</p>
              <p className="mt-1 text-ink-500">{r.health.model.active ? "The fitted model sets the bands." : "Hand weights set the bands; the model scores in the background until it has 10 assisted and 20 honest decisions and a clean replay."}</p>
            </div>
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3 text-xs text-ink-300">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Where hand and model disagree</div>
              {r.health.disagreements.length === 0 ? <p>They agree on every student's band.</p> : <ul className="space-y-1">{r.health.disagreements.map((d) => <li key={d.userId}><b className="text-white">{d.name}</b>: hand {d.hand} · model {d.model}</li>)}</ul>}
            </div>
          </div>

          <h2 className="mb-2 mt-7 font-display text-lg text-white">How detection works</h2>
          <div className="grid gap-3 text-xs leading-relaxed text-ink-300 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <p><b className="text-white">On every solve</b> the live detector checks the time, the per-move rhythm, the crowd's time on that puzzle and whether the tab left the trainer. A flagged win records normally but moves no rating and no per-theme rating. One-move puzzles never flag; on mate-pattern drills the limits halve, because the solver was told the pattern.</p>
              <p className="mt-2"><b className="text-white">Every night</b> (and whenever the panel opens) each student gets a score from 0 to 100 over their last 30 days, or since their last reset or Clear: flagged solves 8 each beyond the first (up to 40) · 2400+ wins under 5 s, 2 each (up to 30) · accuracy going the wrong way with difficulty 15 · faster than the crowd 15 or 8 · a 500+ climb alongside flags 10 · equal strength across all themes 10 or 5 · puzzle rating far above live-game rating 10 or 5.</p>
            </div>
            <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-3">
              <p><b className="text-white">Bands.</b> Under 25 is Clear. 25 to 59 is <span className="text-amber-200">Watch</span>: listed for a look, nothing withheld. 60 and up is <span className="text-rose-200">Review</span>: every rated gain is held until the owner resets or clears, and the owner is emailed the same day.</p>
              <p className="mt-2"><b className="text-white">Your decisions.</b> <span className="text-emerald-200">Clear</span> with a note restarts the student's window. <span className="text-amber-200">Hold</span> stops gains yourself. Only the owner lifts a hold, by Clear or by resetting the rating. Each decision teaches the model.</p>
              <p className="mt-2"><b className="text-white">Proctored exams</b> run full screen; leaving the tab or full screen is recorded per position. <b className="text-white">Students see none of this.</b></p>
            </div>
          </div>
          <p className="mt-6 text-[10px] text-ink-600">Generated {when(r.generatedAt)}.</p>
        </>
      )}
    </div>
  );
}
