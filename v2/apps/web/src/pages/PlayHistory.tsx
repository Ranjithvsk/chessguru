// My games — every online game the signed-in player finished on /play, with the
// same "status" feel as the puzzle history: win/loss/draw, why it ended, the
// rating it moved, and a replay one click away.
import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { liveGames, type LiveGameSummary, type LiveGamesStats, type LiveOutcome, type LiveSpeed } from "../lib/api";

export const SPEED_META: Record<LiveSpeed, { label: string; emoji: string; chip: string; ring: string }> = {
  bullet: { label: "Bullet", emoji: "⚡", chip: "from-amber-500/25 to-amber-500/5 border-amber-400/40", ring: "#fbbf24" },
  blitz: { label: "Blitz", emoji: "🔥", chip: "from-rose-500/25 to-rose-500/5 border-rose-400/40", ring: "#fb7185" },
  rapid: { label: "Rapid", emoji: "🐇", chip: "from-emerald-500/25 to-emerald-500/5 border-emerald-400/40", ring: "#34d399" },
  classical: { label: "Classical", emoji: "🐢", chip: "from-sky-500/25 to-sky-500/5 border-sky-400/40", ring: "#38bdf8" },
};
export const OUTCOME_META: Record<LiveOutcome, { label: string; bar: string; badge: string; dot: string; letter: string }> = {
  win: { label: "Win", bar: "bg-emerald-400", badge: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40", dot: "bg-emerald-400", letter: "W" },
  loss: { label: "Loss", bar: "bg-rose-400", badge: "bg-rose-500/20 text-rose-200 border-rose-400/40", dot: "bg-rose-400", letter: "L" },
  draw: { label: "Draw", bar: "bg-ink-400", badge: "bg-ink-700/60 text-ink-200 border-ink-500/40", dot: "bg-ink-400", letter: "D" },
};

export const tcLabel = (tc: { initial: number; increment: number }) => `${Math.round(tc.initial / 60000)}+${Math.round(tc.increment / 1000)}`;
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
/** Stable, cheerful gradient per name — opponents get a recognisable avatar. */
export function avatarGradient(name: string): string {
  const palettes = ["from-fuchsia-500 to-violet-600", "from-sky-400 to-indigo-600", "from-emerald-400 to-teal-600", "from-amber-400 to-orange-600", "from-rose-400 to-pink-600", "from-lime-400 to-green-600", "from-cyan-400 to-blue-600"];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palettes[h % palettes.length]!;
}

function Sparkline({ points, color }: { points: { r: number }[]; color: string }) {
  if (points.length < 2) return <div className="h-6 w-20 rounded bg-ink-800/40" />;
  const w = 80, h = 24, pad = 2;
  const rs = points.map((p) => p.r);
  const lo = Math.min(...rs), hi = Math.max(...rs);
  const span = Math.max(1, hi - lo);
  const xs = rs.map((r, i) => [pad + (i / (rs.length - 1)) * (w - pad * 2), h - pad - ((r - lo) / span) * (h - pad * 2)] as const);
  const d = xs.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = xs[xs.length - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

function WinRing({ pct, wins, losses, draws }: { pct: number; wins: number; losses: number; draws: number }) {
  const r = 36, c = 2 * Math.PI * r;
  const total = Math.max(1, wins + losses + draws);
  const wArc = (wins / total) * c, dArc = (draws / total) * c;
  return (
    <div className="relative grid h-24 w-24 place-items-center" data-testid="win-ring">
      <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgb(var(--ink-800))" strokeWidth="9" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="#fb7185" strokeWidth="9" strokeDasharray={`${c} ${c}`} className="transition-all duration-700" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="#94a3b8" strokeWidth="9" strokeDasharray={`${wArc + dArc} ${c}`} className="transition-all duration-700" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="#34d399" strokeWidth="9" strokeDasharray={`${wArc} ${c}`} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute text-center leading-tight">
        <div className="font-display text-2xl text-white">{pct}%</div>
        <div className="text-[10px] uppercase tracking-wide text-ink-400">wins</div>
      </div>
    </div>
  );
}

export function FormDots({ form, size = "md" }: { form: LiveOutcome[]; size?: "sm" | "md" }) {
  if (!form.length) return <span className="text-xs text-ink-500">no games yet</span>;
  const dim = size === "sm" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-xs";
  return (
    <div className="flex items-center gap-1" data-testid="form-dots">
      {form.slice().reverse().map((o, i) => (
        <span key={i} className={`grid ${dim} place-items-center rounded-full font-bold text-ink-950 ${OUTCOME_META[o].dot} ${i === form.length - 1 ? "ring-2 ring-white/70" : "opacity-90"}`} title={OUTCOME_META[o].label}>
          {OUTCOME_META[o].letter}
        </span>
      ))}
    </div>
  );
}

function StatTile({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`rounded-xl border border-ink-700/70 bg-ink-900/70 px-3 py-2 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="font-display text-xl text-white">{value}</div>
      {sub && <div className="text-[11px] text-ink-400">{sub}</div>}
    </div>
  );
}

function Pill({ active, onClick, children, tone = "brand" }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: string }) {
  const on = tone === "brand" ? "bg-brand-600 text-white shadow-lg shadow-brand-600/30" : tone === "emerald" ? "bg-emerald-500 text-ink-950" : tone === "rose" ? "bg-rose-500 text-white" : "bg-ink-500 text-white";
  return (
    <button onClick={onClick} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${active ? on : "border border-ink-700 text-ink-300 hover:border-ink-500 hover:text-white"}`}>
      {children}
    </button>
  );
}

export function GameCard({ g }: { g: LiveGameSummary }) {
  const om = OUTCOME_META[g.outcome];
  const sm = SPEED_META[g.speed];
  const diff = g.ratingDiff;
  return (
    <Link
      to={`/play/games/${encodeURIComponent(g.id)}`}
      data-testid="game-card"
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl2 border border-ink-700/70 bg-ink-900/70 p-3 transition hover:-translate-y-0.5 hover:border-ink-500 hover:shadow-xl hover:shadow-black/30"
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${om.bar}`} />
      <div className={`ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br ${avatarGradient(g.opponent.name)} font-display text-lg text-white shadow-inner`}>
        {g.opponent.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${om.badge}`}>{om.label}</span>
          <span className="truncate font-semibold text-white">
            {g.myColor === "white" ? "♔" : "♚"} you <span className="text-ink-500">vs</span> {g.opponent.name}
            {g.opponentRating !== null && <span className="ml-1 text-xs text-ink-400">({g.opponentRating})</span>}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-400">
          <span className="text-ink-300">{g.reasonText}</span>
          <span>{sm.emoji} {sm.label} {tcLabel(g.timeControl)} · {g.rated ? "rated" : "casual"}</span>
          <span>{Math.ceil(g.plies / 2)} moves · {fmtDuration(g.durationMs)}</span>
          <span>{timeAgo(g.finishedAt)}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {diff !== null ? (
          <span className={`rounded-lg px-2 py-0.5 font-mono text-sm font-bold ${diff >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>{diff >= 0 ? "+" : ""}{diff}</span>
        ) : (
          <span className="rounded-lg bg-ink-800 px-2 py-0.5 text-[11px] text-ink-400">casual</span>
        )}
        <span className="text-[11px] text-ink-500 transition group-hover:text-brand-300">Replay ▶</span>
      </div>
    </Link>
  );
}

export default function PlayHistoryPage() {
  const ctx = useOutletContext<{ userId: string | null }>();
  const signedIn = !!ctx?.userId;
  const [stats, setStats] = useState<LiveGamesStats | null>(null);
  const [items, setItems] = useState<LiveGameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [speed, setSpeed] = useState<"all" | LiveSpeed>("all");
  const [outcome, setOutcome] = useState<"all" | LiveOutcome>("all");
  const [rated, setRated] = useState<"all" | "1" | "0">("all");
  const PAGE = 30;

  useEffect(() => {
    if (!signedIn) { setLoading(false); return; }
    liveGames.stats().then(setStats).catch(() => {});
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    liveGames.list({ speed, outcome, rated, offset: 0, limit: PAGE })
      .then((r) => { if (cancelled) return; setItems(r.items); setTotal(r.total); })
      .catch((e) => { if (!cancelled) setErr(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [signedIn, speed, outcome, rated]);

  const loadMore = async () => {
    const r = await liveGames.list({ speed, outcome, rated, offset: items.length, limit: PAGE });
    setItems((cur) => [...cur, ...r.items]);
    setTotal(r.total);
  };

  const groups = useMemo(() => {
    const out: { label: string; games: LiveGameSummary[] }[] = [];
    for (const g of items) {
      const d = new Date(g.finishedAt);
      const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
      const label = d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      const last = out[out.length - 1];
      if (last && last.label === label) last.games.push(g);
      else out.push({ label, games: [g] });
    }
    return out;
  }, [items]);

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-display text-3xl text-white">My games</h1>
        <div className="rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-500/15 via-ink-900 to-fuchsia-500/10 p-6 text-center">
          <div className="text-4xl">📜</div>
          <div className="mt-2 font-display text-xl text-white">Sign in to keep your game history</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-300">Guest games are not saved. With an account every online game is recorded with its result, rating change and a full replay.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/login?back=/play/history" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Sign in</Link>
            <Link to="/play" className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800">Play as guest</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-testid="play-history">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-500/20 via-ink-900 to-fuchsia-500/10 p-5">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 left-1/3 h-40 w-40 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-brand-200/80">Online play</div>
            <h1 className="font-display text-3xl text-white">My games</h1>
            <div className="mt-1 text-sm text-ink-300">
              {stats ? (
                <>{stats.games} game{stats.games === 1 ? "" : "s"}{stats.lastPlayedAt ? ` · last played ${timeAgo(stats.lastPlayedAt)}` : ""}</>
              ) : "Loading…"}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[11px] uppercase tracking-wide text-ink-400">Form</span>
              <FormDots form={stats?.form ?? []} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <WinRing pct={stats?.winRate ?? 0} wins={stats?.wins ?? 0} losses={stats?.losses ?? 0} draws={stats?.draws ?? 0} />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-emerald-500/15 px-3 py-1.5"><div className="font-display text-xl text-emerald-200">{stats?.wins ?? 0}</div><div className="text-[10px] uppercase text-emerald-300/70">won</div></div>
              <div className="rounded-lg bg-rose-500/15 px-3 py-1.5"><div className="font-display text-xl text-rose-200">{stats?.losses ?? 0}</div><div className="text-[10px] uppercase text-rose-300/70">lost</div></div>
              <div className="rounded-lg bg-ink-700/50 px-3 py-1.5"><div className="font-display text-xl text-ink-100">{stats?.draws ?? 0}</div><div className="text-[10px] uppercase text-ink-400">drawn</div></div>
            </div>
          </div>
        </div>

        {/* Ratings per speed */}
        <div className="relative mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="rating-chips">
          {(Object.keys(SPEED_META) as LiveSpeed[]).map((s) => {
            const st = stats?.bySpeed[s];
            const m = SPEED_META[s];
            return (
              <button
                key={s}
                onClick={() => setSpeed(speed === s ? "all" : s)}
                className={`flex items-center justify-between rounded-xl border bg-gradient-to-br p-3 text-left transition hover:brightness-110 ${m.chip} ${speed === s ? "ring-2 ring-white/60" : ""}`}
              >
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-200/80">{m.emoji} {m.label}</div>
                  <div className="font-display text-2xl text-white">
                    {st?.rating ?? <span className="text-ink-400">—</span>}
                    {st?.rating !== null && st?.provisional && <span className="ml-0.5 text-base text-ink-300" title="Provisional — settles after a few more rated games">?</span>}
                  </div>
                  <div className="text-[11px] text-ink-300">{st ? `${st.wins}W · ${st.losses}L · ${st.draws}D` : ""}</div>
                </div>
                <Sparkline points={st?.history ?? []} color={m.ring} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Stat tiles */}
      {stats && stats.games > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile label="Win streak" value={`${stats.currentStreak} 🔥`} sub={`best ${stats.longestStreak}`} />
          <StatTile label="Time at the board" value={fmtDuration(stats.totalMs)} sub={`~${Math.ceil(stats.avgPlies / 2)} moves per game`} />
          <StatTile label="As white / black" value={`${stats.colors.white.games ? Math.round((stats.colors.white.wins / stats.colors.white.games) * 100) : 0}% / ${stats.colors.black.games ? Math.round((stats.colors.black.wins / stats.colors.black.games) * 100) : 0}%`} sub="win rate by colour" />
          <StatTile label="Best win" value={stats.bestWin ? `${stats.bestWin.rating}` : "—"} sub={stats.bestWin ? `beat ${stats.bestWin.opponent}` : "win a rated game"} tone={stats.bestWin ? "border-gold-500/40" : ""} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl2 border border-ink-700 bg-ink-900 p-2" data-testid="filters">
        <Pill active={speed === "all"} onClick={() => setSpeed("all")}>All speeds</Pill>
        {(Object.keys(SPEED_META) as LiveSpeed[]).map((s) => (
          <Pill key={s} active={speed === s} onClick={() => setSpeed(s)}>{SPEED_META[s].emoji} {SPEED_META[s].label}</Pill>
        ))}
        <span className="mx-1 h-5 w-px bg-ink-700" />
        <Pill active={outcome === "all"} onClick={() => setOutcome("all")}>Any result</Pill>
        <Pill active={outcome === "win"} tone="emerald" onClick={() => setOutcome("win")}>Wins</Pill>
        <Pill active={outcome === "loss"} tone="rose" onClick={() => setOutcome("loss")}>Losses</Pill>
        <Pill active={outcome === "draw"} tone="ink" onClick={() => setOutcome("draw")}>Draws</Pill>
        <span className="mx-1 h-5 w-px bg-ink-700" />
        <Pill active={rated === "all"} onClick={() => setRated("all")}>Rated + casual</Pill>
        <Pill active={rated === "1"} onClick={() => setRated("1")}>Rated</Pill>
        <Pill active={rated === "0"} onClick={() => setRated("0")}>Casual</Pill>
        <span className="ml-auto text-xs text-ink-400">{total} game{total === 1 ? "" : "s"}</span>
      </div>

      {/* List */}
      {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}
      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl2 bg-ink-900/70" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
          <div className="text-4xl">♟️</div>
          <div className="mt-2 font-display text-xl text-white">{total === 0 && speed === "all" && outcome === "all" && rated === "all" ? "No games yet" : "Nothing matches these filters"}</div>
          <p className="mt-1 text-sm text-ink-400">Every online game you finish lands here with its result, rating change and a replay.</p>
          <Link to="/play" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Play a game</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((grp) => (
            <div key={grp.label}>
              <div className="mb-1.5 flex items-center gap-2 px-1 text-[11px] uppercase tracking-wide text-ink-500"><span>{grp.label}</span><span className="h-px flex-1 bg-ink-800" /></div>
              <div className="space-y-2">{grp.games.map((g) => <GameCard key={g.id} g={g} />)}</div>
            </div>
          ))}
          {items.length < total && (
            <button onClick={loadMore} className="w-full rounded-xl2 border border-ink-700 bg-ink-900 py-2 text-sm text-ink-200 hover:bg-ink-800">Show more ({total - items.length} left)</button>
          )}
        </div>
      )}
    </div>
  );
}
