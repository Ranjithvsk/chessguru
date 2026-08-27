// Academy-wide competitive leaderboard. Anyone in the academy (owner, coach,
// students) can see this. Percentile-based ChessGuru Score keeps ranking
// meaningful even when everyone is at similar chess strength — see
// AcademyService.buildLeaderboard for the exact weighting.
//
// Route: /academy/leaderboard
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, get } from "../lib/api";
import { getAcademyOpeningLeaderboard, type AcademyOpeningLeaderboardRow } from "../lib/opening-trainer-api";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Row = {
  studentId: string;
  username: string;
  name: string | null;
  coachId: string | null;
  rank: number;
  score: number;
  prevRank?: number | null;
  deltaRank?: number | null;
  currentRating: number;
  peakRating: number;
  blindfoldRating: number | null;
  puzzles: number;
  boostedPuzzles?: number;
  blindfoldPuzzles: number;
  puzzlesLifetime: number;
  accuracy: number;
  mistakesRatio: number;
  avgSolveMs: number | null;
  themesCount: number;
  themes: string[];
  streak: number;
  longestStreak: number;
  attendance30d: number;
  attendanceStreak?: number;
  badgesUnlocked?: number;
};

type Champion = { studentId: string; username: string; name: string | null; value: number } | null;
type LeaderboardResp = {
  period: string;
  bucket: string | null;
  computedAt: string;
  academyId: string;
  studentCount: number;
  weights: Record<string, number>;
  rows: Row[];
  champions: {
    overall: Champion;
    mostPuzzles: Champion;
    bestAccuracy: Champion;
    fastest: Champion;
    longestStreak: Champion;
    mostThemes: Champion;
    blindfoldKing: Champion;
    comeback?: Champion;
  };
  activeBoost: null | {
    theme: string;
    multiplier: number;
    startAt: string;
    endAt: string;
    byName: string;
    note: string;
  };
};

type Period = "today" | "7d" | "30d" | "180d" | "365d" | "lifetime";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today",    label: "Today" },
  { key: "7d",       label: "7 days" },
  { key: "30d",      label: "1 month" },
  { key: "180d",     label: "6 months" },
  { key: "365d",     label: "1 year" },
  { key: "lifetime", label: "Lifetime" },
];

// Uniform 200-point rating bands. Key = server bucket id (u800 for
// under-800, r800..r1800 for 200-wide bands, r2000 for 2000+).
type Bucket = "all" | "u800" | "r800" | "r1000" | "r1200" | "r1400" | "r1600" | "r1800" | "r2000";
const BUCKETS: { key: Bucket; label: string; range: string }[] = [
  { key: "all",   label: "All",           range: "every level" },
  { key: "u800",  label: "🐣 Rookie",       range: "< 800" },
  { key: "r800",  label: "🧒 Beginner",     range: "800–999" },
  { key: "r1000", label: "📗 Novice",       range: "1000–1199" },
  { key: "r1200", label: "🌱 Improver",     range: "1200–1399" },
  { key: "r1400", label: "⚡ Intermediate", range: "1400–1599" },
  { key: "r1600", label: "🎯 Advanced",     range: "1600–1799" },
  { key: "r1800", label: "💎 Expert",       range: "1800–1999" },
  { key: "r2000", label: "👑 Master",       range: "2000+" },
];

/** Map a rating to its 200-point bucket. Kept in sync with the server-side
 *  ranges in academy.service.ts `inBucket`. */
function bucketForRating(r: number | undefined | null): Bucket {
  if (r == null) return "all";
  if (r < 800) return "u800";
  if (r < 1000) return "r800";
  if (r < 1200) return "r1000";
  if (r < 1400) return "r1200";
  if (r < 1600) return "r1400";
  if (r < 1800) return "r1600";
  if (r < 2000) return "r1800";
  return "r2000";
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
function pct(n: number): string { return `${Math.round(n * 100)}%`; }

function RankBadge({ rank, pulse = false }: { rank: number; pulse?: boolean }) {
  const cls =
    rank === 1 ? "bg-gradient-to-br from-amber-300 via-yellow-400 to-yellow-600 text-amber-950 ring-2 ring-amber-300/60 shadow-[0_0_20px_rgba(251,191,36,0.35)]" :
    rank === 2 ? "bg-gradient-to-br from-slate-100 via-slate-300 to-slate-500 text-slate-900 ring-2 ring-slate-300/60 shadow-lg" :
    rank === 3 ? "bg-gradient-to-br from-orange-300 via-orange-500 to-orange-700 text-orange-950 ring-2 ring-orange-400/60 shadow-lg" :
                 "bg-ink-800 text-ink-300 ring-1 ring-ink-700";
  const emoji = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  return (
    <span className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full text-base font-bold tabular-nums ${cls}`}>
      {pulse && rank === 1 && (
        <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/30" />
      )}
      <span className="relative">{emoji ?? rank}</span>
    </span>
  );
}

/** Horizontal bar visualising 0..100 score. Gradient shifts warm-to-cool
 *  by percentile — top scores glow gold, middle purple, low grey. */
function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const grad =
    pct >= 70 ? "from-amber-400 via-orange-400 to-rose-400" :
    pct >= 40 ? "from-brand-500 via-fuchsia-500 to-purple-500" :
                "from-sky-500 via-cyan-500 to-teal-500";
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
      <div className={`h-full rounded-full bg-gradient-to-r ${grad} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Podium — top-3 students stacked visually. #1 in the centre, taller. */
function Podium({ rows }: { rows: Row[] }) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) return null;
  const first = top3[0]!;
  const second = top3[1];
  const third = top3[2];
  const Card = ({ r, place, height, emoji, gradient, ring }: {
    r: Row; place: number; height: string; emoji: string; gradient: string; ring: string;
  }) => (
    <Link to={`/academy/students/${encodeURIComponent(r.studentId)}/performance`}
      className={`group flex flex-col items-center rounded-t-2xl border-b-0 border ${ring} bg-gradient-to-b ${gradient} px-4 pt-4 ${height} shadow-xl hover:brightness-110 transition`}>
      <div className="text-3xl leading-none drop-shadow-lg">{emoji}</div>
      <div className="mt-2 text-center">
        <div className="font-display text-base text-white group-hover:text-brand-100 truncate max-w-[120px]">{r.name || r.username}</div>
        <div className="mt-0.5 text-[10px] text-white/70">@{r.username}</div>
      </div>
      <div className="mt-auto pb-3 text-center">
        <div className="tabular-nums text-2xl font-black text-white drop-shadow">{r.score.toFixed(1)}</div>
        <div className="text-[10px] uppercase tracking-wide text-white/80">rank #{place}</div>
      </div>
    </Link>
  );
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4 py-2">
      {second ? (
        <Card r={second} place={2} height="h-40" emoji="🥈"
          gradient="from-slate-400/90 to-slate-700/90"
          ring="border-slate-300/40" />
      ) : <div className="w-32" />}
      <Card r={first} place={1} height="h-52" emoji="👑"
        gradient="from-amber-400/90 via-yellow-500/90 to-amber-700/90"
        ring="border-amber-300/60" />
      {third ? (
        <Card r={third} place={3} height="h-36" emoji="🥉"
          gradient="from-orange-500/90 to-orange-800/90"
          ring="border-orange-400/50" />
      ) : <div className="w-32" />}
    </div>
  );
}

function ChampionCard({ emoji, title, subtitle, champion, formatValue, tone = "brand" }: {
  emoji: string; title: string; subtitle: string;
  champion: Champion;
  formatValue: (v: number) => string;
  tone?: "brand" | "amber" | "emerald" | "sky" | "fuchsia" | "rose";
}) {
  const toneCls: Record<string, string> = {
    brand:    "border-brand-500/40 from-brand-900/50 to-ink-900/70 hover:from-brand-900/80 text-brand-300",
    amber:    "border-amber-500/40 from-amber-900/50 to-ink-900/70 hover:from-amber-900/80 text-amber-300",
    emerald:  "border-emerald-500/40 from-emerald-900/50 to-ink-900/70 hover:from-emerald-900/80 text-emerald-300",
    sky:      "border-sky-500/40 from-sky-900/50 to-ink-900/70 hover:from-sky-900/80 text-sky-300",
    fuchsia:  "border-fuchsia-500/40 from-fuchsia-900/50 to-ink-900/70 hover:from-fuchsia-900/80 text-fuchsia-300",
    rose:     "border-rose-500/40 from-rose-900/50 to-ink-900/70 hover:from-rose-900/80 text-rose-300",
  };
  const valueTone: Record<string, string> = {
    brand: "text-brand-200", amber: "text-amber-200", emerald: "text-emerald-200",
    sky: "text-sky-200", fuchsia: "text-fuchsia-200", rose: "text-rose-200",
  };
  if (!champion) return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/40 p-3 opacity-60">
      <div className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
        <span className="text-lg leading-none">{emoji}</span><span>{title}</span>
      </div>
      <div className="mt-2 text-sm text-ink-500">No data yet</div>
    </div>
  );
  const cls = toneCls[tone] || toneCls.brand;
  return (
    <Link to={`/academy/students/${encodeURIComponent(champion.studentId)}/performance`}
      className={`group block rounded-xl border bg-gradient-to-br ${cls} p-3 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg`}>
      <div className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide">
        <span className="text-xl leading-none drop-shadow group-hover:scale-110 transition">{emoji}</span>
        <span>{title}</span>
      </div>
      <div className="mt-1.5 font-display text-lg text-white truncate">{champion.name || champion.username}</div>
      <div className="mt-0.5 text-xs text-ink-400">
        <span className={`tabular-nums text-lg font-black ${valueTone[tone] || valueTone.brand}`}>{formatValue(champion.value)}</span>
        <span className="ml-1.5">{subtitle}</span>
      </div>
    </Link>
  );
}

/** Rank-delta arrow: ▲n / ▼n / • (new). Colored by direction. */
function RankDelta({ delta }: { delta: number | null | undefined }) {
  if (delta == null) return <span className="text-[10px] text-ink-600" title="new to leaderboard">•</span>;
  if (delta === 0) return <span className="text-[10px] text-ink-500">—</span>;
  if (delta > 0) return <span className="text-[10px] font-semibold text-emerald-400" title={`up ${delta}`}>▲{delta}</span>;
  return <span className="text-[10px] font-semibold text-rose-400" title={`down ${-delta}`}>▼{-delta}</span>;
}

const COMMON_BOOST_THEMES = [
  { theme: "endgame",       label: "♚ Endgame Week",     desc: "Force training on real-game conversion" },
  { theme: "mate",          label: "☠️ Mate Week",        desc: "Master checkmating patterns" },
  { theme: "fork",          label: "🍴 Fork Week",        desc: "Sharpen double-attack vision" },
  { theme: "pin",           label: "📌 Pin Week",         desc: "Punish immobile pieces" },
  { theme: "sacrifice",     label: "💥 Sacrifice Week",   desc: "Learn to invest material for advantage" },
  { theme: "defensiveMove", label: "🛡️ Defence Week",     desc: "Hold worse positions and swindle draws" },
  { theme: "attraction",    label: "🧲 Attraction Week",  desc: "Lure kings and queens onto bad squares" },
  { theme: "blindfold",     label: "🙈 Blindfold Week",   desc: "Visualisation — the master's edge" },
];

function BoostBanner({ boost, canManage, onEnd }: { boost: LeaderboardResp["activeBoost"]; canManage: boolean; onEnd: () => void }) {
  if (!boost) return null;
  const daysLeft = Math.max(0, Math.ceil((new Date(boost.endAt).getTime() - Date.now()) / (24 * 60 * 60_000)));
  return (
    <div className="relative overflow-hidden rounded-xl2 border border-fuchsia-500/40 bg-gradient-to-r from-fuchsia-900/40 via-purple-900/40 to-brand-900/40 p-4">
      <div className="pointer-events-none absolute -top-6 -right-6 h-32 w-32 rounded-full bg-fuchsia-500/20 blur-[80px]" />
      <div className="relative flex flex-wrap items-baseline gap-3">
        <span className="text-2xl">🎯</span>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fuchsia-300">Academy boost active · {daysLeft}d left</div>
          <div className="mt-0.5 text-lg font-display text-white">
            <b className="capitalize">{boost.theme}</b>
            <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-sm tabular-nums">{boost.multiplier.toFixed(1)}× score</span>
          </div>
          <div className="mt-1 text-xs text-fuchsia-200">
            Every {boost.theme === "blindfold" ? "blindfold" : `"${boost.theme}"`} puzzle you solve counts {boost.multiplier}× on the leaderboard.
            {boost.note && <span className="ml-1 italic text-white/70">— {boost.note}</span>}
          </div>
          <div className="mt-0.5 text-[10px] text-ink-400">Set by {boost.byName}</div>
        </div>
        {canManage && (
          <button type="button" onClick={onEnd}
            className="ml-auto rounded-lg border border-white/20 px-2.5 py-1 text-[11px] text-white/80 hover:bg-white/10">
            End boost
          </button>
        )}
      </div>
    </div>
  );
}

function StartBoostModal({ open, onClose, onSubmit, submitting }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (b: { theme: string; multiplier: number; days: number; note: string }) => void;
  submitting: boolean;
}) {
  const [theme, setTheme] = useState("endgame");
  const [customTheme, setCustomTheme] = useState("");
  const [multiplier, setMultiplier] = useState(1.5);
  const [days, setDays] = useState(7);
  const [note, setNote] = useState("");
  if (!open) return null;
  const chosen = theme === "__custom" ? customTheme.trim() : theme;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-fuchsia-500/40 bg-ink-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg text-white">🎯 Start a boost week</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-white">×</button>
        </div>
        <p className="mt-1 text-xs text-ink-400">
          Pick a theme to spotlight — every matching puzzle students solve will count {multiplier}× on the leaderboard for {days} days. Great for driving directed practice on a real chess weakness.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Boost theme</label>
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {COMMON_BOOST_THEMES.map((t) => (
                <label key={t.theme} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs transition ${theme === t.theme ? "border-fuchsia-500/70 bg-fuchsia-900/30 text-white" : "border-ink-700 bg-ink-800/40 text-ink-300 hover:bg-ink-800"}`}>
                  <input type="radio" name="theme" value={t.theme} checked={theme === t.theme}
                    onChange={() => setTheme(t.theme)} className="mt-0.5 accent-fuchsia-500" />
                  <div>
                    <div className="font-semibold">{t.label}</div>
                    <div className="text-[10px] opacity-80">{t.desc}</div>
                  </div>
                </label>
              ))}
              <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-xs transition ${theme === "__custom" ? "border-fuchsia-500/70 bg-fuchsia-900/30 text-white" : "border-ink-700 bg-ink-800/40 text-ink-300 hover:bg-ink-800"}`}>
                <input type="radio" name="theme" value="__custom" checked={theme === "__custom"}
                  onChange={() => setTheme("__custom")} className="accent-fuchsia-500" />
                <input value={customTheme} onChange={(e) => setCustomTheme(e.target.value)} placeholder="Custom theme (e.g. skewer)"
                  className="flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-white placeholder:text-ink-500"
                  onFocus={() => setTheme("__custom")} />
              </label>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Multiplier</label>
              <div className="mt-1 flex items-center gap-2">
                <input type="range" min="1.2" max="3" step="0.1" value={multiplier}
                  onChange={(e) => setMultiplier(Number(e.target.value))} className="flex-1 accent-fuchsia-500" />
                <span className="w-12 rounded bg-ink-800 px-2 py-1 text-center text-sm tabular-nums text-white">{multiplier.toFixed(1)}×</span>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Duration (days)</label>
              <div className="mt-1 flex items-center gap-2">
                <input type="range" min="1" max="30" step="1" value={days}
                  onChange={(e) => setDays(Number(e.target.value))} className="flex-1 accent-fuchsia-500" />
                <span className="w-12 rounded bg-ink-800 px-2 py-1 text-center text-sm tabular-nums text-white">{days}d</span>
              </div>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Note to students (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. focus on K+P endings this week"
              className="mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-white placeholder:text-ink-500" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:text-white">Cancel</button>
          <button
            disabled={!chosen || submitting}
            onClick={() => onSubmit({ theme: chosen, multiplier, days, note })}
            className="rounded-lg bg-fuchsia-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50">
            {submitting ? "Starting…" : `Start ${chosen ? `"${chosen}"` : ""} boost →`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const { data: myRating } = useQuery({ queryKey: ["me-rating"], queryFn: api.myRating });
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("7d");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [sortBy, setSortBy] = useState<"score" | "consistency">("score");
  const [showBoost, setShowBoost] = useState(false);
  const canManage = !!auth?.loggedIn && (auth.role === "academy_owner" || auth.role === "coach");
  // Super-admin cross-academy picker (owner ask 2026-08-27, ranjith.vsk).
  // For admins, load the fleet-wide academy list and let them switch which
  // academy's leaderboard to view. Non-admins never see the dropdown.
  const isSuperAdmin = !!auth?.admin;
  // Deep-linkable initial pick — /academy/leaderboard?academy=__all__ from
  // the /admin/users "View as leaderboard" button lands with all-users
  // pre-selected. Non-admins ignore the param server-side anyway.
  const [urlParams] = useSearchParams();
  const [pickedAcademy, setPickedAcademy] = useState<string>(() => urlParams.get("academy") || "");
  const academiesQ = useQuery({
    queryKey: ["admin-academies"],
    queryFn: () => get<Array<{ id: string; name: string; studentCount: number }>>("/api/admin/academies"),
    enabled: isSuperAdmin,
    staleTime: 5 * 60_000,
  });
  const activeAcademyId = pickedAcademy || auth?.academyId || "";
  const activeAcademyName = academiesQ.data?.find(a => a.id === activeAcademyId)?.name;
  // Students land on their own rating-bucket by default so they see peers
  // near their level. Coach/owner keep "all" so they see the whole roster.
  // Fires exactly once — after that, the user can freely switch tabs.
  // For students, we WAIT for myRating to arrive before defaulting; we
  // must not mark "defaulted" early or the switch never happens.
  const bucketDefaulted = useRef(false);
  useEffect(() => {
    if (bucketDefaulted.current) return;
    if (!auth?.loggedIn || !auth?.role) return;
    if (auth.role === "student") {
      // Wait for rating to load before we can pick a bucket.
      if (typeof myRating?.rating !== "number") return;
      bucketDefaulted.current = true;
      setBucket(bucketForRating(myRating.rating));
    } else {
      // Coach / owner — keep "all" and stop the effect from re-firing.
      bucketDefaulted.current = true;
    }
  }, [auth?.loggedIn, auth?.role, myRating?.rating]);
  const q = useQuery({
    queryKey: ["academy-leaderboard", period, bucket, sortBy, activeAcademyId],
    queryFn: () => get<LeaderboardResp>(
      `/api/academy/leaderboard?period=${period}`
      + (bucket !== "all" ? `&bucket=${bucket}` : "")
      + (sortBy === "consistency" ? "&sortBy=consistency" : "")
      + (isSuperAdmin && pickedAcademy ? `&academy=${encodeURIComponent(pickedAcademy)}` : ""),
    ),
    enabled: !!auth?.loggedIn && (!!auth?.academyId || (isSuperAdmin && !!pickedAcademy)),
    staleTime: 60_000,
  });
  const startBoostMut = useMutation({
    mutationFn: (body: { theme: string; multiplier: number; days: number; note: string }) =>
      fetch(`${BASE}/api/academy/boost`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => { setShowBoost(false); qc.invalidateQueries({ queryKey: ["academy-leaderboard"] }); },
  });
  const endBoostMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/academy/boost/end`, { method: "POST", credentials: "include" }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["academy-leaderboard"] }); },
  });

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/academy/leaderboard" replace />;
  // Super-admin without an academyId: show academy-picker instead of the
  // "not in an academy" wall so they can view any tenant's leaderboard.
  if (auth && !auth.academyId && isSuperAdmin) return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6">
        <div className="text-3xl">🛡️</div>
        <h1 className="mt-2 font-display text-xl text-white">Pick an academy (super-admin)</h1>
        <p className="mt-2 text-sm text-ink-400">You're not a member of any academy; pick one to view its leaderboard.</p>
        <select value={pickedAcademy} onChange={(e) => setPickedAcademy(e.target.value)}
          className="mt-3 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white">
          <option value="">— choose —</option>
          {(academiesQ.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.studentCount})</option>
          ))}
        </select>
      </div>
    </div>
  );
  if (auth && !auth.academyId) return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6">
        <div className="text-3xl">🏛️</div>
        <h1 className="mt-2 font-display text-xl text-white">Not in an academy</h1>
        <p className="mt-2 text-sm text-ink-400">Only academy members see the leaderboard.</p>
        <Link to="/signup-academy" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
          Create your academy →
        </Link>
      </div>
    </div>
  );

  const rows = q.data?.rows ?? [];
  const champs = q.data?.champions;
  const meRow = rows.find((r) => r.studentId === auth?.userId);

  return (
    <div className="relative mx-auto max-w-6xl space-y-6 px-3 py-6">
      {/* Ambient glow — soft radial washes so the page feels alive.
          Pointer-events off so they never block clicks. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute -top-16 left-1/4 h-72 w-72 rounded-full bg-amber-500/10 blur-[110px]" />
        <div className="absolute top-40 right-0 h-80 w-80 rounded-full bg-fuchsia-500/10 blur-[130px]" />
        <div className="absolute bottom-20 left-0 h-64 w-64 rounded-full bg-brand-500/10 blur-[110px]" />
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-400">Academy · leaderboard</div>
          <h1 className="font-display text-3xl bg-gradient-to-r from-amber-300 via-fuchsia-300 to-brand-300 bg-clip-text text-transparent">🏆 Academy Leaderboard</h1>
          <div className="mt-1 text-sm text-ink-400">
            {q.data?.studentCount ?? 0} students · ranked by Overall Score (0–100).
            {isSuperAdmin && activeAcademyName && <span className="ml-2 rounded bg-brand-500/25 px-2 py-0.5 text-[11px] font-semibold text-brand-200">viewing: {activeAcademyName}</span>}
          </div>
          {isSuperAdmin && (
            // Super-admin cross-academy picker — visible only for admins.
            // "" = use their own session academyId. Any other value swaps
            // the leaderboard's scoping via ?academy= (server-side gated).
            <div className="mt-2 flex items-center gap-2 text-xs text-ink-400">
              <span className="rounded bg-ink-800 px-2 py-1 font-semibold text-ink-300">🛡️ admin</span>
              <span>View academy:</span>
              <select value={pickedAcademy} onChange={(e) => setPickedAcademy(e.target.value)}
                className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-white">
                <option value="">— my academy ({auth?.academyId ?? "none"}) —</option>
                {(academiesQ.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.studentCount} students)</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-700 text-xs">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1.5 font-medium transition ${period === p.key ? "bg-brand-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
                {p.label}
              </button>
            ))}
          </div>
          {canManage && !q.data?.activeBoost && (
            <button type="button" onClick={() => setShowBoost(true)}
              className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-500">
              🎯 Start boost
            </button>
          )}
          <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
        </div>
      </header>

      {/* Owner 2026-08-23: "reward consistent players — consistency is key
          to success." Toggle between the all-rounder ChessGuru Score and a
          pure-consistency rank so kids who show up daily get their own
          spotlight even if they're not top-rated. */}
      <div className="flex overflow-hidden rounded-xl border border-ink-700 text-sm">
        <button type="button" onClick={() => setSortBy("score")}
          className={`flex-1 px-4 py-2 font-semibold transition ${sortBy === "score" ? "bg-gradient-to-r from-amber-500 to-fuchsia-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}>
          🏆 Overall Score
        </button>
        <button type="button" onClick={() => setSortBy("consistency")}
          className={`flex-1 px-4 py-2 font-semibold transition ${sortBy === "consistency" ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white" : "bg-ink-900 text-ink-300 hover:bg-ink-800"}`}
          title="Kids who show up regularly — active days, cadence, streak">
          🔥 Most Consistent
        </button>
      </div>

      {/* Active boost banner — driven by the coach; multiplies matching-theme
          puzzles for real training focus this week. */}
      <BoostBanner boost={q.data?.activeBoost ?? null} canManage={canManage} onEnd={() => endBoostMut.mutate()} />

      {/* Rating-bucket tabs — beginners compete inside their bucket, not
          against the whole roster. Fair fights = motivation for improvers. */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-800 bg-ink-950/40 p-1.5">
        {BUCKETS.map((b) => (
          <button key={b.key} type="button" onClick={() => setBucket(b.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${bucket === b.key ? "bg-brand-600 text-white shadow" : "bg-transparent text-ink-300 hover:bg-ink-800"}`}
            title={b.range || "Every student in your academy"}>
            {b.label}
            {b.range && <span className="ml-1 text-[10px] opacity-70">{b.range}</span>}
          </button>
        ))}
      </div>

      {q.isLoading && <div className="text-sm text-ink-400">Loading leaderboard…</div>}
      {q.error && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          {String((q.error as any)?.message || "Could not load leaderboard.")}
        </div>
      )}

      {/* Podium — visual top-3, gold-silver-bronze */}
      {rows.length > 0 && (
        <div className="rounded-2xl border border-ink-700 bg-gradient-to-br from-amber-950/30 via-brand-950/40 to-fuchsia-950/30 p-4 sm:p-6">
          <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-amber-300">
            🏆 Podium · {PERIODS.find((p) => p.key === period)?.label}
          </div>
          <Podium rows={rows} />
        </div>
      )}

      {/* Micro-champions — one card per dimension */}
      {champs && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ChampionCard tone="emerald" emoji="🧩" title="Most puzzles" subtitle="solved in period" champion={champs.mostPuzzles} formatValue={(v) => String(v)} />
          <ChampionCard tone="sky"     emoji="🎯" title="Best accuracy" subtitle="in period" champion={champs.bestAccuracy} formatValue={(v) => `${v}%`} />
          <ChampionCard tone="amber"   emoji="⚡" title="Fastest solver" subtitle="avg / puzzle" champion={champs.fastest} formatValue={(v) => fmtMs(v)} />
          <ChampionCard tone="rose"    emoji="🔥" title="Longest streak" subtitle="days in a row" champion={champs.longestStreak} formatValue={(v) => `${v}d`} />
          <ChampionCard tone="brand"   emoji="🎨" title="Most theme variety" subtitle="distinct themes" champion={champs.mostThemes} formatValue={(v) => String(v)} />
          <ChampionCard tone="fuchsia" emoji="🙈" title="Blindfold king" subtitle="blindfold puzzles" champion={champs.blindfoldKing} formatValue={(v) => String(v)} />
          {champs.comeback && (
            <ChampionCard tone="rose" emoji="🚀" title="Comeback of the period" subtitle="ranks moved up" champion={champs.comeback} formatValue={(v) => `+${v}`} />
          )}
        </div>
      )}

      {/* Your row callout — only for students so they can find themselves fast */}
      {meRow && auth?.role === "student" && (
        <div className="rounded-xl2 border border-brand-500/40 bg-brand-900/20 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-300">You</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <RankBadge rank={meRow.rank} />
            <span className="font-display text-xl text-white">{meRow.name || meRow.username}</span>
            <span className="text-lg font-bold tabular-nums text-brand-300">{meRow.score.toFixed(1)}</span>
            <span className="text-xs text-ink-400">of 100</span>
            <span className="ml-auto text-xs text-ink-400">
              🧩 {meRow.puzzles} · 🎯 {pct(meRow.accuracy)} · 🔥 {meRow.streak}d · 🎨 {meRow.themesCount}
            </span>
          </div>
        </div>
      )}

      {/* Main table — sticky header, scrollable body capped at ~20 rows.
          Column set: rank/name/score/rating/puzzles-period/lifetime/accuracy/
          avg-time/blindfold/themes/streak/attend. Long, so it scrolls
          horizontally on mobile — the first two cols freeze via sticky. */}
      <div className="rounded-xl border border-ink-700 bg-ink-900/40">
        <div className="flex items-baseline justify-between border-b border-ink-800 px-3 py-2 text-[11px] text-ink-500">
          <span>Showing {Math.min(rows.length, 20)} of {rows.length} students</span>
          <span>Score = 25% rating + 25% puzzles + 15% accuracy + 15% streak + 10% themes + 10% attend</span>
        </div>
        <div className="max-h-[880px] overflow-y-auto overflow-x-auto overscroll-contain">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-ink-800/95 text-[11px] uppercase tracking-wide text-ink-400 backdrop-blur">
              <tr>
                <th className="sticky left-0 z-20 bg-ink-800/95 px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Student</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2 text-right">Rating</th>
                <th className="px-3 py-2 text-right" title="Puzzles solved in period">🧩 Puzzles</th>
                <th className="px-3 py-2 text-right" title="All-time puzzles solved">Lifetime</th>
                <th className="px-3 py-2 text-right" title="Blindfold puzzles solved in period">🙈 Blind</th>
                <th className="px-3 py-2 text-right" title="Wins / total in period">🎯 Acc</th>
                <th className="px-3 py-2 text-right" title="Average time to solve a puzzle in period">⚡ Avg</th>
                <th className="px-3 py-2 text-right" title="Distinct themes solved in period">🎨 Themes</th>
                <th className="px-3 py-2 text-right" title="Current daily-puzzle streak">🔥 Streak</th>
                <th className="px-3 py-2 text-right" title="Classes attended in last 30 days">📅 Attend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isMe = auth?.userId === r.studentId;
                const topClass =
                  r.rank === 1 ? "bg-gradient-to-r from-amber-500/10 to-transparent" :
                  r.rank === 2 ? "bg-gradient-to-r from-slate-400/10 to-transparent" :
                  r.rank === 3 ? "bg-gradient-to-r from-orange-500/10 to-transparent" :
                                 "";
                return (
                  <tr key={r.studentId} className={`border-t border-ink-800 transition hover:bg-ink-800/40 ${isMe ? "bg-brand-900/20" : topClass}`}>
                    <td className={`sticky left-0 z-10 px-3 py-2 ${isMe ? "bg-brand-900/30" : "bg-ink-900/60"}`}>
                      <div className="flex flex-col items-center gap-0.5">
                        <RankBadge rank={r.rank} pulse />
                        <RankDelta delta={r.deltaRank} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/academy/students/${encodeURIComponent(r.studentId)}/performance`}
                        className="font-semibold text-white hover:text-brand-300">{r.name || r.username}</Link>
                      <div className="text-xs text-ink-500">
                        @{r.username}
                        {isMe && <span className="ml-1 text-brand-300">· you</span>}
                        {(r.badgesUnlocked ?? 0) > 0 && (
                          <span className="ml-2 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200" title="Achievements unlocked">🎖️ {r.badgesUnlocked}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right min-w-[110px]">
                      <span className="tabular-nums font-bold text-brand-200">{r.score.toFixed(1)}</span>
                      <ScoreBar score={r.score} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="text-white">{r.currentRating}</span>
                      {r.peakRating > r.currentRating && (
                        <span className="ml-1 text-[10px] text-amber-300" title={`Peak: ${r.peakRating}`}>▲{r.peakRating}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={r.puzzles === 0 ? "text-ink-500" : "text-emerald-300"}>{r.puzzles}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-300">{r.puzzlesLifetime}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={r.blindfoldPuzzles === 0 ? "text-ink-500" : "text-fuchsia-300"}>{r.blindfoldPuzzles}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.puzzles >= 5 ? (
                        <span className={r.accuracy >= 0.75 ? "text-emerald-300" : r.accuracy >= 0.5 ? "text-amber-300" : "text-rose-300"}>
                          {pct(r.accuracy)}
                        </span>
                      ) : <span className="text-ink-500">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-300">{fmtMs(r.avgSolveMs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span title={r.themes.slice(0, 8).join(", ") || "no themes yet"} className={r.themesCount === 0 ? "text-ink-500" : "text-sky-300"}>{r.themesCount}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={r.streak === 0 ? "text-ink-500" : "text-amber-300"}>{r.streak}d</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={r.attendance30d === 0 ? "text-rose-300" : "text-emerald-200"}>{r.attendance30d}</span>
                      <span className="text-ink-500">/30</span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !q.isLoading && (
                <tr><td colSpan={12} className="px-3 py-8 text-center text-sm text-ink-500">
                  No students yet — the leaderboard fills as your academy grows.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[11px] text-ink-500">
        Score is normalised inside your academy (percentile-based) so a rising star doesn't need to catch the top rating to move up.
        Accuracy requires ≥5 puzzles in the period to count.
      </div>

      {/* Openings leaderboard — rollout step 4 of the Openings Dashboard
          plan. Same visual language as the puzzles section above so the
          two feeds read as one page. */}
      <OpeningsLeaderboardSection />

      <StartBoostModal
        open={showBoost}
        onClose={() => setShowBoost(false)}
        onSubmit={(b) => startBoostMut.mutate(b)}
        submitting={startBoostMut.isPending}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Openings leaderboard section — rollout step 4. Ranks every student in
// the academy by Opening-Trainer discipline score (success, streak,
// activity, coach-compliance). Server aggregates in one shot; we just
// render.
// ─────────────────────────────────────────────────────────────────────
function OpeningsLeaderboardSection() {
  const q = useQuery({
    queryKey: ["academy-openings-leaderboard"],
    queryFn: getAcademyOpeningLeaderboard,
    staleTime: 60_000,
  });
  const rows = q.data?.rows ?? [];
  const top10 = rows.slice(0, 10);
  const podium = top10.slice(0, 3);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-950/40 via-brand-950/40 to-amber-950/20 p-5">
      <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-fuchsia-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-0 h-52 w-52 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="relative">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-300">Openings · discipline</div>
            <h2 className="bg-gradient-to-r from-amber-300 via-fuchsia-300 to-brand-300 bg-clip-text font-display text-2xl font-bold text-transparent">
              🎓 Opening Trainer Leaderboard
            </h2>
          </div>
          <div className="text-[11px] text-ink-300">
            Score = 40% success · 25% streak · 15% activity · 20% coach-compliance
          </div>
        </div>

        {q.isLoading && <div className="text-sm text-ink-400">Loading openings leaderboard…</div>}
        {q.error && (
          <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {String((q.error as any)?.message || "Could not load openings leaderboard.")}
          </div>
        )}
        {!q.isLoading && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-fuchsia-500/30 bg-ink-950/40 p-6 text-center text-sm text-ink-300">
            No opening drills recorded yet. Have a coach share an opening with the "Force-add" checkbox — every drill fills this board.
          </div>
        )}

        {/* Podium */}
        {podium.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
            {podium.map((r) => {
              const cls =
                r.rank === 1 ? "from-amber-300 via-yellow-400 to-yellow-600 text-amber-950 ring-2 ring-amber-300/60 shadow-[0_0_20px_rgba(251,191,36,0.35)]" :
                r.rank === 2 ? "from-slate-100 via-slate-300 to-slate-500 text-slate-900 ring-2 ring-slate-300/60 shadow-lg" :
                               "from-orange-300 via-orange-500 to-orange-700 text-orange-950 ring-2 ring-orange-400/60 shadow-lg";
              const height = r.rank === 1 ? "h-32 sm:h-36" : "h-24 sm:h-28";
              return (
                <div key={r.userId} className={`flex flex-col items-center justify-end rounded-t-2xl bg-gradient-to-b ${cls} ${height} px-2 py-3`}>
                  <div className="text-lg font-bold">#{r.rank}</div>
                  <div className="line-clamp-1 text-center text-xs font-semibold">{r.name}</div>
                  <div className="mt-1 tabular-nums text-xl font-black drop-shadow">{r.disciplineScore}</div>
                  <div className="text-[10px] font-semibold opacity-80">🔥 {r.streak}d · {r.successPct7}%</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Full table (top 10) */}
        {top10.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-ink-800/60 bg-ink-950/50">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="bg-ink-800/80 text-[10px] uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-2 py-2 text-left sm:px-3">#</th>
                  <th className="px-2 py-2 text-left sm:px-3">Student</th>
                  <th className="px-2 py-2 text-right sm:px-3">Score</th>
                  <th className="hidden px-2 py-2 text-right sm:table-cell sm:px-3" title="Consecutive days with ≥1 drill">🔥 Streak</th>
                  <th className="px-2 py-2 text-right sm:px-3" title="First-try correct % (last 7 days)">🎯 7d</th>
                  <th className="hidden px-2 py-2 text-right sm:table-cell sm:px-3" title="Drill sessions in last 7 days">🎲 Sessions</th>
                  <th className="hidden px-2 py-2 text-right md:table-cell sm:px-3" title="Distinct openings scored ≥90% in last 30 days">🏆 Strong</th>
                  <th className="px-2 py-2 text-right sm:px-3" title="Coach-assigned openings drilled this week">🎓 Assigned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/60">
                {top10.map((r) => {
                  const rowBg =
                    r.rank === 1 ? "bg-gradient-to-r from-amber-500/10 to-transparent" :
                    r.rank === 2 ? "bg-gradient-to-r from-slate-400/10 to-transparent" :
                    r.rank === 3 ? "bg-gradient-to-r from-orange-500/10 to-transparent" : "";
                  return (
                    <tr key={r.userId} className={`${rowBg} hover:bg-ink-800/40`}>
                      <td className="px-2 py-2 text-left tabular-nums sm:px-3">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                          r.rank === 1 ? "bg-amber-400 text-amber-950" :
                          r.rank === 2 ? "bg-slate-200 text-slate-900" :
                          r.rank === 3 ? "bg-orange-400 text-orange-950" :
                                          "bg-ink-800 text-ink-300"
                        }`}>{r.rank}</span>
                      </td>
                      <td className="px-2 py-2 text-left sm:px-3">
                        <div className="line-clamp-1 font-semibold text-white">{r.name}</div>
                        <div className="text-[10px] text-ink-500">@{r.username}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                        <span className="text-lg font-bold text-fuchsia-200">{r.disciplineScore}</span>
                        <span className="text-[10px] text-ink-500">/100</span>
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell sm:px-3">
                        <span className={r.streak > 0 ? "text-amber-300" : "text-ink-500"}>{r.streak}d</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                        <span className={r.successPct7 >= 80 ? "text-emerald-300" : r.successPct7 >= 50 ? "text-amber-300" : "text-ink-400"}>
                          {r.successPct7 > 0 ? `${r.successPct7}%` : "—"}
                        </span>
                      </td>
                      <td className="hidden px-2 py-2 text-right tabular-nums text-ink-300 sm:table-cell sm:px-3">{r.sessions7}</td>
                      <td className="hidden px-2 py-2 text-right tabular-nums text-emerald-200 md:table-cell sm:px-3">{r.strongOpenings30}</td>
                      <td className="px-2 py-2 text-right tabular-nums sm:px-3">
                        {r.assignedTotal > 0 ? (
                          <span className={r.assignedDone === r.assignedTotal ? "text-emerald-300" : "text-amber-300"}>
                            {r.assignedDone}/{r.assignedTotal}
                          </span>
                        ) : <span className="text-ink-600">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] text-ink-500">
          🏆 Strong = openings scored ≥90% first-try in the last 30 days.
          🎓 Assigned counts coach force-added openings drilled at least once in the last 7 days.
        </p>
      </div>
    </div>
  );
}

