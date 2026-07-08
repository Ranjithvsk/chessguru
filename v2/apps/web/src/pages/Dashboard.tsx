import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
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
};

const PROVISIONAL_GAMES = 5;

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
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dash>("/api/puzzles/dashboard") });

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

  return (
    <div className="space-y-5">
      <h1 className="font-display text-2xl text-white">📊 My performance</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl2 border p-5 ${c.hero ? "border-brand-600/50 bg-brand-600/10" : "border-ink-700 bg-ink-900"}`}>
            <div className="text-xs text-ink-400">{c.label}</div>
            <div className={`mt-1 font-display font-bold tabular-nums ${c.hero ? "text-3xl text-brand-300" : "text-2xl text-white"}`}>{c.value}</div>
            <div className="mt-1 text-[11px] text-ink-500">{c.sub}</div>
          </div>
        ))}
      </div>

      {data.days && <RatingChart days={data.days} />}

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
