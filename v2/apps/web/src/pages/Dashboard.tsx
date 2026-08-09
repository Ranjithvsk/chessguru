import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { get } from "../lib/api";
import { prettify } from "../lib/format";

// My Performance dashboard (owner 2026-07-08): global rating, per-theme Glicko
// strengths & weaknesses, 30-day progress. Theme ratings only exist once trained;
// low-game ratings are marked provisional (?). Clicking a theme trains it.
type ThemeRow = { theme: string; rating: number; rd: number; games: number; last: string | null };
type Dash = {
  loggedIn: boolean;
  global?: { rating: number; rd: number; games: number };
  blindfold?: { rating: number; games: number } | null;
  totals?: { attempted: number; wins: number; accuracy: number };
  themes?: ThemeRow[];
  themesBf?: ThemeRow[];
  days?: { day: string; solves: number; wins: number; rating: number }[];
  bands?: { lo: number; hi: number; attempted: number; solved: number; accuracy: number }[];
  themeSpeeds?: { theme: string; medianMs: number; n: number; trend?: "faster" | "slower" | "steady" | "new" }[];
  byHour?: { hour: number; n: number; wins: number; medianMs: number | null }[];
  personalBests?: {
    bestRating: number | null; bestRatingDate: string | null;
    bestDay: number | null; bestDayDate: string | null;
    biggestGain: number | null; biggestGainDate: string | null;
    fastestMs: number | null; fastestDate: string | null;
  };
};

const PROVISIONAL_GAMES = 5;

// Compute current + longest daily streaks from the days array (dates ISO yyyy-mm-dd,
// sparse — only days with activity are present). Current streak = consecutive
// today-and-back run of days-with-solves; a one-day grace if today has none yet.
function streaks(days: NonNullable<Dash["days"]>): { current: number; longest: number } {
  const active = new Set(days.filter((d) => d.solves > 0).map((d) => d.day));
  if (active.size === 0) return { current: 0, longest: 0 };
  const sorted = [...active].sort();
  let longest = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T00:00:00Z");
    const cur  = new Date(sorted[i]     + "T00:00:00Z");
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86_400_000);
    run = diff === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const cursor = new Date(today);
  let current = 0;
  if (!active.has(iso(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1); // one-day grace
  while (active.has(iso(cursor))) { current++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return { current, longest };
}

// Streak card — warm gradient with a big 🔥 count and the personal best underneath.
function StreakCard({ current, longest }: { current: number; longest: number }) {
  const hot = current > 0;
  return (
    <div className={`rounded-xl2 border p-5 ${hot ? "border-orange-400/50 bg-gradient-to-br from-orange-500/20 via-rose-500/10 to-amber-500/5" : "border-ink-700 bg-ink-900"}`}>
      <div className="text-xs text-ink-400">Daily streak</div>
      <div className={`mt-1 flex items-baseline gap-2 font-display font-bold tabular-nums ${hot ? "text-3xl text-orange-200" : "text-2xl text-white"}`}>
        <span>{current}</span>
        <span className={`text-2xl ${hot ? "" : "grayscale opacity-50"}`}>🔥</span>
      </div>
      <div className="mt-1 text-[11px] text-ink-500">
        {hot ? `keep it going · ` : `no active streak · `}
        <span className="text-amber-300">🏆 best {longest} day{longest === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

// GitHub-style contribution heatmap over the last N weeks (default 13). Sunday-first
// columns; darker = more solves that day. Native title tooltip on each cell.
function Heatmap({ days, weeks = 13 }: { days: NonNullable<Dash["days"]>; weeks?: number }) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  const endDow = now.getUTCDay();
  const endSat = new Date(now); endSat.setUTCDate(now.getUTCDate() + (6 - endDow));
  const start  = new Date(endSat); start.setUTCDate(endSat.getUTCDate() - weeks * 7 + 1);
  const cells: { date: string; solves: number; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({ date: iso, solves: byDay.get(iso)?.solves ?? 0, future: d > now });
  }
  const tone = (n: number, future: boolean) => {
    if (future) return "bg-ink-900/50";
    if (n === 0) return "bg-ink-800 hover:bg-ink-700";
    if (n < 5)   return "bg-emerald-900/80 hover:bg-emerald-800";
    if (n < 10)  return "bg-emerald-700 hover:bg-emerald-600";
    if (n < 20)  return "bg-emerald-500 hover:bg-emerald-400";
    return              "bg-emerald-300 hover:bg-emerald-200";
  };
  const dayLabel = ["Sun", "", "Tue", "", "Thu", "", "Sat"];
  const monthTicks: { col: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const c = cells[w * 7];
    const d = new Date(c.date + "T00:00:00Z");
    if (d.getUTCDate() <= 7) monthTicks.push({ col: w, label: d.toLocaleString(undefined, { month: "short", timeZone: "UTC" }) });
  }
  const totalSolves = cells.reduce((s, c) => s + c.solves, 0);
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white">📅 Activity · last {weeks} weeks
          <span className="ml-2 text-xs font-normal text-ink-400">{totalSolves} solves</span>
        </span>
        <span className="flex items-center text-xs text-ink-400">
          <span className="mr-1">less</span>
          {[0, 3, 7, 15, 25].map((n) => (
            <span key={n} className={`mx-0.5 inline-block h-3 w-3 rounded-[3px] align-middle ${tone(n, false)}`} />
          ))}
          <span className="ml-1">more</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        {/* Month labels aligned to columns */}
        <div className="ml-8 flex text-[10px] text-ink-500" style={{ gap: 3 }}>
          {Array.from({ length: weeks }, (_, w) => {
            const t = monthTicks.find((m) => m.col === w);
            return <span key={w} style={{ width: 14, minWidth: 14 }}>{t?.label ?? ""}</span>;
          })}
        </div>
        <div className="mt-1 flex" style={{ gap: 3 }}>
          <div className="mr-2 flex flex-col justify-between text-[10px] leading-none text-ink-500" style={{ gap: 3 }}>
            {dayLabel.map((l, i) => <span key={i} style={{ height: 14 }}>{l}</span>)}
          </div>
          {Array.from({ length: weeks }, (_, w) => (
            <div key={w} className="flex flex-col" style={{ gap: 3 }}>
              {Array.from({ length: 7 }, (_, r) => {
                const c = cells[w * 7 + r];
                return (
                  <span key={r}
                    title={c.future ? "" : `${c.solves} solve${c.solves === 1 ? "" : "s"} · ${c.date}`}
                    className={`rounded-[3px] transition-transform hover:scale-125 ${tone(c.solves, c.future)}`}
                    style={{ width: 14, height: 14 }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Compact solve-time formatter for the "fastest solve" tile — matches the History
// badge style ("8.4s", "1m 12s") so the same numbers read the same everywhere.
function fmtSolveShort(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return `${m}m${r ? ` ${r}s` : ""}`;
}
// Human date: "12 Aug" — dense enough for the tile footer, doesn't repeat the year.
function niceDate(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { day: "2-digit", month: "short", timeZone: "UTC" }); }
  catch { return iso; }
}

// Trophy shelf. Four mini-tiles, each with an icon + big number + label + date. Uses
// a warm gold→amber gradient card so it reads as "celebration" and stands apart from
// the ink-tone cards above. Tiles are skipped individually when their value is null
// (e.g. no ms rows yet -> no fastest-solve tile) so the card never shows a "—" gap.
function PersonalBests({ pb }: { pb: NonNullable<Dash["personalBests"]> }) {
  const tiles = [
    pb.bestRating   != null ? { icon: "🏆", label: "Best rating",       value: String(pb.bestRating),        date: pb.bestRatingDate,   tone: "text-amber-200" } : null,
    pb.bestDay      != null ? { icon: "📅", label: "Most solves in a day", value: String(pb.bestDay),         date: pb.bestDayDate,      tone: "text-emerald-200" } : null,
    pb.biggestGain  != null ? { icon: "📈", label: "Biggest 1-day gain", value: `+${pb.biggestGain}`,        date: pb.biggestGainDate,  tone: "text-cyan-200" } : null,
    pb.fastestMs    != null ? { icon: "⚡", label: "Fastest solve",      value: fmtSolveShort(pb.fastestMs),  date: pb.fastestDate,      tone: "text-brand-200" } : null,
  ].filter(Boolean) as Array<{ icon: string; label: string; value: string; date: string | null; tone: string }>;
  if (tiles.length === 0) return null;
  return (
    <div className="rounded-xl2 border border-amber-500/30 bg-gradient-to-br from-amber-500/15 via-orange-500/5 to-ink-900 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white">🏆 Personal bests</span>
        <span className="text-xs text-ink-400">last 120 days</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-amber-500/20 bg-ink-900/60 p-3 transition-transform hover:-translate-y-0.5">
            <div className="flex items-baseline justify-between">
              <span className="text-lg">{t.icon}</span>
              {t.date && <span className="text-[10px] text-ink-500">{niceDate(t.date)}</span>}
            </div>
            <div className={`mt-1 font-display text-2xl font-bold tabular-nums ${t.tone}`}>{t.value}</div>
            <div className="mt-0.5 text-[11px] text-ink-400">{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Compact "best time of day" card. 24-bar activity chart + a callout for the
// sharpest hour (fastest median among hours with ≥5 solves and ≥3 timed wins,
// so a single burst can't crown a random hour). Self-hides when there's not
// enough data yet.
function BestTimeOfDay({ hours }: { hours: NonNullable<Dash["byHour"]> }) {
  const total = hours.reduce((s, h) => s + h.n, 0);
  if (total < 20) return null;   // nothing meaningful to say with < 20 solves
  const eligible = hours.filter((h) => h.n >= 5 && h.medianMs != null);
  const sharpest = eligible.slice().sort((a, b) => (a.medianMs! - b.medianMs!))[0] ?? null;
  const busiest  = hours.slice().sort((a, b) => b.n - a.n)[0] ?? null;
  const maxN = Math.max(...hours.map((h) => h.n), 1);
  // Human hour label: "7pm" style. midnight/noon get named for scanability.
  const label = (h: number) => h === 0 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`;
  const fmt = (ms: number) => ms < 10_000 ? `${(ms / 1000).toFixed(1)}s`
    : ms < 60_000 ? `${Math.round(ms / 1000)}s`
    : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white">🕐 Best time of day</span>
        <span className="text-xs text-ink-400">activity by hour (your local time)</span>
      </div>
      {/* Callouts */}
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-brand-300">Sharpest hour</div>
          {sharpest ? (
            <>
              <div className="font-display text-lg font-bold text-brand-100">{label(sharpest.hour)}</div>
              <div className="text-[11px] text-ink-500">
                median {fmt(sharpest.medianMs!)} · {sharpest.wins} wins of {sharpest.n}
              </div>
            </>
          ) : <div className="text-[11px] text-ink-500">Need more timed wins per hour to say.</div>}
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-amber-300">Most active hour</div>
          {busiest && busiest.n > 0 ? (
            <>
              <div className="font-display text-lg font-bold text-amber-100">{label(busiest.hour)}</div>
              <div className="text-[11px] text-ink-500">
                {busiest.n} solves · {busiest.n > 0 ? Math.round((busiest.wins / busiest.n) * 100) : 0}% accuracy
              </div>
            </>
          ) : <div className="text-[11px] text-ink-500">No activity yet.</div>}
        </div>
      </div>
      {/* 24-bar activity chart. Height ∝ solve count; sharpest hour gets a
          highlight ring so the callout finds itself visually. */}
      <div className="flex items-end gap-0.5" style={{ height: 72 }}>
        {hours.map((h) => {
          const pct = (h.n / maxN) * 100;
          const isSharp = sharpest?.hour === h.hour;
          return (
            <div key={h.hour} className="flex-1 flex flex-col items-stretch justify-end" title={`${label(h.hour)} — ${h.n} solves · ${h.wins} wins${h.medianMs != null ? ` · median ${fmt(h.medianMs)}` : ""}`}>
              <div className={`rounded-t ${isSharp
                ? "bg-gradient-to-t from-brand-500 to-accent-400 ring-1 ring-brand-300/60"
                : "bg-ink-700"}`}
                style={{ height: `${Math.max(4, pct)}%` }} />
            </div>
          );
        })}
      </div>
      {/* Hour ticks — every 3rd hour, small, keeps the axis readable without noise. */}
      <div className="mt-1 flex text-[9px] text-ink-500">
        {hours.map((h) => (
          <div key={h.hour} className="flex-1 text-center">
            {h.hour % 3 === 0 ? label(h.hour) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// Per-theme median solve time. Uses the same "click a theme to train it" affordance
// as the ThemeBar so the card doubles as an "attack your slow themes" launch pad.
// Only rendered when at least a few themes have >= 3 timed solves — otherwise it
// reads as noise and the card hides itself.
function SpeedByTheme({ speeds, onTrain }: { speeds: NonNullable<Dash["themeSpeeds"]>; onTrain: (theme: string) => void }) {
  if (speeds.length === 0) return null;
  // Coarse tint by absolute time — matches the speed-tier chips on Puzzles /
  // History (⚡ fast, 🚀 quick, ⏱ steady, 🐢 slow) so the same numbers read the
  // same everywhere.
  const tint = (ms: number) =>
    ms < 10_000 ? { emoji: "⚡", cls: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30" }
    : ms < 30_000 ? { emoji: "🚀", cls: "bg-cyan-500/15 text-cyan-200 border-cyan-500/35" }
    : ms < 60_000 ? { emoji: "⏱", cls: "bg-brand-500/15 text-brand-100 border-brand-500/30" }
    : { emoji: "🐢", cls: "bg-amber-500/10 text-amber-100 border-amber-500/25" };
  const fastest = speeds.slice(0, 5);
  const slowest = speeds.slice(-5).reverse().filter((s) => !fastest.some((f) => f.theme === s.theme));
  const fmt = (ms: number) => ms < 10_000 ? `${(ms / 1000).toFixed(1)}s`
    : ms < 60_000 ? `${Math.round(ms / 1000)}s`
    : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  // Trend chip: ↓ green for faster, ↑ rose for slower, ✦ brand for a brand-new
  // theme (no prior-window data yet), muted em-dash for steady. Nothing rendered
  // when the backend didn't compute a trend (old dashboard payloads).
  const trendChip = (trend?: "faster" | "slower" | "steady" | "new") => {
    if (!trend) return null;
    const meta = trend === "faster" ? { icon: "↓", cls: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30", title: "20%+ faster in the last 30 days" }
      : trend === "slower" ? { icon: "↑", cls: "bg-rose-500/15 text-rose-200 border-rose-500/30",              title: "20%+ slower in the last 30 days" }
      : trend === "new"    ? { icon: "✦", cls: "bg-brand-500/15 text-brand-100 border-brand-500/30",           title: "New — no data from before the last 30 days" }
      :                      { icon: "–", cls: "bg-ink-700/40 text-ink-400 border-ink-600",                     title: "Steady within ±20% vs the previous 30 days" };
    return (
      <span title={meta.title} className={`rounded border px-1 text-[11px] font-semibold ${meta.cls}`}>{meta.icon}</span>
    );
  };
  const Row = ({ s }: { s: { theme: string; medianMs: number; n: number; trend?: "faster" | "slower" | "steady" | "new" } }) => {
    const t = tint(s.medianMs);
    return (
      <button onClick={() => onTrain(s.theme)} title={`Train ${prettify(s.theme)}`}
        className="group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink-800">
        <span className="truncate text-sm text-ink-200 group-hover:text-white">{prettify(s.theme)}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] text-ink-500 tabular-nums">n={s.n}</span>
          {trendChip(s.trend)}
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${t.cls}`}>
            <span className="mr-1">{t.emoji}</span><span className="tabular-nums">{fmt(s.medianMs)}</span>
          </span>
        </span>
      </button>
    );
  };
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white">⚡ Solve speed by theme</span>
        <span className="text-xs text-ink-400">median · won puzzles only · min 3 solves</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Fastest</div>
          {fastest.map((s) => <Row key={s.theme} s={s} />)}
        </div>
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300">Slowest — worth drilling</div>
          {slowest.length > 0
            ? slowest.map((s) => <Row key={s.theme} s={s} />)
            : <p className="py-4 text-center text-[11px] text-ink-500">Not enough distinct themes yet.</p>}
        </div>
      </div>
    </div>
  );
}

// Per-difficulty band chart: horizontal bars, one per 200-pt band, split solved/missed
// with an accuracy % on the right. The band containing the user's CURRENT rating gets
// a subtle ring so you can eyeball "am I holding accuracy where my rating claims I am?"
// Accuracy tint: green ≥70, teal ≥55, amber ≥40, rose <40 — a coarse tier is honest
// (small samples lie) and easier to scan than a raw gradient.
function BandChart({ bands, userRating }: { bands: NonNullable<Dash["bands"]>; userRating: number }) {
  if (bands.length === 0) return null;
  const maxAttempted = Math.max(...bands.map((b) => b.attempted), 1);
  const currentBandLo = Math.floor(userRating / 200) * 200;
  const tint = (acc: number, attempted: number) => {
    if (attempted < 3) return { bar: "bg-ink-700",     lab: "text-ink-400" };  // provisional
    if (acc >= 70)      return { bar: "bg-emerald-500", lab: "text-emerald-300" };
    if (acc >= 55)      return { bar: "bg-teal-500",    lab: "text-teal-300" };
    if (acc >= 40)      return { bar: "bg-amber-500",   lab: "text-amber-300" };
    return                     { bar: "bg-rose-500",    lab: "text-rose-300" };
  };
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white">🎯 Accuracy by puzzle difficulty</span>
        <span className="text-xs text-ink-400">your rating: <b className="text-brand-300">{userRating}</b></span>
      </div>
      <div className="space-y-1.5">
        {bands.map((b) => {
          const t = tint(b.accuracy, b.attempted);
          const width = (b.attempted / maxAttempted) * 100;
          const isCurrent = b.lo === currentBandLo;
          const provisional = b.attempted < 3;
          return (
            <div key={b.lo} className={`grid grid-cols-[5rem_1fr_4.5rem] items-center gap-3 rounded-lg px-2 py-1 ${isCurrent ? "ring-1 ring-brand-500/50 bg-brand-500/5" : ""}`}
                 title={`${b.solved}/${b.attempted} solved at ${b.lo}–${b.hi}`}>
              <span className={`text-xs tabular-nums ${isCurrent ? "font-semibold text-brand-200" : "text-ink-300"}`}>
                {b.lo}–{b.hi}
              </span>
              <span className="relative h-4 overflow-hidden rounded-md bg-ink-800">
                <span className={`block h-full rounded-md ${t.bar} transition-all`} style={{ width: `${Math.max(3, width)}%` }} />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-end pr-1.5 text-[10px] font-semibold tabular-nums text-white/85 mix-blend-luminosity">
                  {b.solved}/{b.attempted}
                </span>
              </span>
              <span className={`text-right text-sm font-semibold tabular-nums ${t.lab}`}>
                {b.accuracy}%{provisional && <span className="ml-0.5 text-gold-400" title="fewer than 3 attempts — noisy">?</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500">
        <span>Bar width = how many you attempted in that band</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-500" />&lt;40
          <span className="h-2 w-2 rounded-sm bg-amber-500" />40+
          <span className="h-2 w-2 rounded-sm bg-teal-500" />55+
          <span className="h-2 w-2 rounded-sm bg-emerald-500" />70+
        </span>
      </div>
    </div>
  );
}

function RatingChart({ days }: { days: NonNullable<Dash["days"]> }) {
  const pts = days.filter((d) => d.rating > 0);
  if (pts.length < 2) return null;
  const w = 640, h = 120, pad = 6;
  const min = Math.min(...pts.map((d) => d.rating)), max = Math.max(...pts.map((d) => d.rating));
  const span = Math.max(60, max - min);
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (r: number) => h - pad - ((r - min) / span) * (h - pad * 2);
  const path = pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.rating).toFixed(1)}`).join(" ");
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-white">Rating progress</span>
        <span className="text-xs text-ink-400">last {pts.length} active days · {min}–{max}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
        <path d={path} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((d, i) => <circle key={d.day} cx={x(i)} cy={y(d.rating)} r="2.5" fill="#34d399" />)}
      </svg>
    </div>
  );
}

function ThemeBar({ t, max, min, onTrain }: { t: ThemeRow; max: number; min: number; onTrain: (theme: string) => void }) {
  const provisional = t.games < PROVISIONAL_GAMES;
  const pct = Math.max(6, ((t.rating - min) / Math.max(1, max - min)) * 100);
  return (
    <button onClick={() => onTrain(t.theme)} title={`Train ${prettify(t.theme)}`}
      className="group grid grid-cols-[10rem_1fr_5.5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-ink-800">
      <span className="truncate text-sm text-ink-200 group-hover:text-white">{prettify(t.theme)}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-ink-800">
        <span className={`block h-full rounded-full ${provisional ? "bg-ink-500" : "bg-gradient-to-r from-brand-600 to-accent-400"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right text-sm tabular-nums">
        <b className="text-white">{t.rating}</b>{provisional && <span className="text-gold-400">?</span>}
        <span className="ml-1 text-xs text-ink-500">({t.games})</span>
      </span>
    </button>
  );
}

export default function DashboardPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const as = sp.get("as") || null;   // admin-only: view another user's dashboard
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", as],
    queryFn: () => get<Dash>(`/api/puzzles/dashboard${as ? `?as=${encodeURIComponent(as)}` : ""}`),
  });

  const train = (theme: string) => {
    try { localStorage.setItem("cg_theme", theme); localStorage.removeItem("cg_puzzle"); } catch { /* */ }
    nav("/");
  };

  if (isLoading) return <div className="grid h-64 place-items-center text-ink-400">Loading your performance…</div>;
  if (!data?.loggedIn) {
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
        <div className="text-3xl">📊</div>
        <h1 className="mt-2 font-display text-xl text-white">My performance</h1>
        <p className="mt-2 text-sm text-ink-400">Sign in to track your puzzle rating, theme strengths and progress over time.</p>
        <Link to="/login?back=/dashboard" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Sign in</Link>
      </div>
    );
  }

  const themes = data.themes ?? [];
  const rated = themes.filter((t) => t.games >= PROVISIONAL_GAMES);
  const viewedAs = as;   // admin "view as" comes from ?as=<u>; ignored by backend for non-admins
  const strengths = rated.slice(0, 5);
  const weaknesses = rated.slice(-5).reverse();
  const max = themes.length ? Math.max(...themes.map((t) => t.rating)) : 1500;
  const min = themes.length ? Math.min(...themes.map((t) => t.rating)) : 1500;

  const cards = [
    { label: "Puzzle rating", value: data.global?.rating ?? 1500, sub: `${data.global?.games ?? 0} rated solves`, hero: true },
    { label: "Accuracy", value: `${data.totals?.accuracy ?? 0}%`, sub: `${data.totals?.wins ?? 0} of ${data.totals?.attempted ?? 0} solved` },
    { label: "Themes trained", value: themes.length, sub: `${rated.length} with reliable ratings` },
    ...(data.blindfold ? [{ label: "Blindfold rating", value: data.blindfold.rating, sub: `${data.blindfold.games} solves` }] : []),
  ];
  const streak = data.days ? streaks(data.days) : { current: 0, longest: 0 };

  return (
    <div className="space-y-5">
      {viewedAs && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl2 border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
          <span>👀 Viewing <b>{viewedAs}</b>'s performance</span>
          <Link to={`/history?as=${encodeURIComponent(viewedAs)}`} className="underline hover:text-white">full history →</Link>
          <Link to="/dashboard" className="ml-auto underline hover:text-white">← view mine</Link>
        </div>
      )}
      <h1 className="font-display text-2xl text-white">{viewedAs ? `${viewedAs}'s performance` : "📊 My performance"}</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl2 border p-5 ${c.hero ? "border-brand-600/50 bg-brand-600/10" : "border-ink-700 bg-ink-900"}`}>
            <div className="text-xs text-ink-400">{c.label}</div>
            <div className={`mt-1 font-display font-bold tabular-nums ${c.hero ? "text-3xl text-brand-300" : "text-2xl text-white"}`}>{c.value}</div>
            <div className="mt-1 text-[11px] text-ink-500">{c.sub}</div>
          </div>
        ))}
        <StreakCard current={streak.current} longest={streak.longest} />
      </div>

      {data.days && <Heatmap days={data.days} />}
      {data.personalBests && <PersonalBests pb={data.personalBests} />}
      {data.days && <RatingChart days={data.days} />}
      {data.bands && data.bands.length > 0 && <BandChart bands={data.bands} userRating={data.global?.rating ?? 1500} />}
      {data.themeSpeeds && data.themeSpeeds.length > 0 && <SpeedByTheme speeds={data.themeSpeeds} onTrain={train} />}
      {data.byHour && <BestTimeOfDay hours={data.byHour} />}

      {rated.length >= 3 && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl2 border border-accent-400/30 bg-accent-400/5 p-5">
            <div className="mb-2 text-sm font-semibold text-accent-400">💪 Strengths</div>
            {strengths.map((t) => <ThemeBar key={t.theme} t={t} max={max} min={min} onTrain={train} />)}
          </div>
          <div className="rounded-xl2 border border-rose-400/30 bg-rose-400/5 p-5">
            <div className="mb-2 text-sm font-semibold text-rose-300">🎯 Needs work — train these!</div>
            {weaknesses.map((t) => <ThemeBar key={t.theme} t={t} max={max} min={min} onTrain={train} />)}
          </div>
        </div>
      )}

      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-white">All theme ratings</span>
          <span className="text-xs text-ink-500">? = provisional (fewer than {PROVISIONAL_GAMES} solves) · click any theme to train it</span>
        </div>
        {themes.length === 0
          ? <p className="py-6 text-center text-sm text-ink-400">Solve a few puzzles and your theme ratings will appear here. <Link className="text-brand-400 underline" to="/">Start training →</Link></p>
          : <div className="mt-2 grid gap-0.5 md:grid-cols-2 md:gap-x-8">{themes.map((t) => <ThemeBar key={t.theme} t={t} max={max} min={min} onTrain={train} />)}</div>}
      </div>

      {(data.themesBf?.length ?? 0) > 0 && (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-white">🕶️ Blindfold theme ratings</span>
            <span className="text-xs text-ink-500">rated separately from regular puzzles</span>
          </div>
          <div className="mt-2 grid gap-0.5 md:grid-cols-2 md:gap-x-8">
            {(data.themesBf ?? []).map((t) => <ThemeBar key={t.theme} t={t} max={Math.max(...(data.themesBf ?? []).map((x) => x.rating))} min={Math.min(...(data.themesBf ?? []).map((x) => x.rating))} onTrain={() => nav("/blindfold")} />)}
          </div>
        </div>
      )}

      <p className="text-xs text-ink-500">
        Your main puzzle rating is its own independent rating from every solve — untrained themes never affect it.
        Theme training serves puzzles at your <b>theme</b> rating once it has {PROVISIONAL_GAMES - 2}+ solves.
      </p>
    </div>
  );
}
