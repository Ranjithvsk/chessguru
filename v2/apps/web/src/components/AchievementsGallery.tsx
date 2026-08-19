// Achievement gallery — badges tied to real chess-skill milestones. Each
// badge is a training goal that transfers to over-the-board play.
// Shown on the Student performance page (both coach view and self-view).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

type Ach = {
  id: string;
  category: string;
  tier: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  emoji: string;
  name: string;
  chessBenefit: string;
  unlocked: boolean;
  progress: number;
  progressLabel: string;
  unlockedAt: string | null;
};
type Resp = {
  student: { _id: string; username: string; name: string | null };
  unlockedCount: number;
  total: number;
  achievements: Ach[];
};

const TIER_BG: Record<Ach["tier"], string> = {
  bronze:   "from-orange-500/70 to-orange-800/70 ring-orange-400/50 shadow-[0_0_20px_rgba(249,115,22,0.15)]",
  silver:   "from-slate-300/70 to-slate-600/70 ring-slate-300/50 shadow-[0_0_20px_rgba(203,213,225,0.15)]",
  gold:     "from-amber-300/80 to-amber-700/80 ring-amber-400/60 shadow-[0_0_24px_rgba(251,191,36,0.25)]",
  platinum: "from-cyan-300/80 to-cyan-600/80 ring-cyan-300/60 shadow-[0_0_24px_rgba(103,232,249,0.25)]",
  diamond:  "from-fuchsia-300/80 via-purple-400/80 to-indigo-600/80 ring-fuchsia-300/70 shadow-[0_0_28px_rgba(232,121,249,0.3)]",
};

const CATEGORY_LABEL: Record<string, string> = {
  puzzles:   "Puzzle milestones",
  rating:    "Rating milestones",
  theme:     "Theme mastery",
  streak:    "Consistency",
  blindfold: "Blindfold visualisation",
  special:   "Special",
};

function AchBadge({ a }: { a: Ach }) {
  const lockedCls = "border border-ink-800 bg-ink-900/40 opacity-60";
  const unlockedCls = `border border-transparent bg-gradient-to-br ${TIER_BG[a.tier]} ring-2 text-white`;
  const pct = a.unlocked ? 100 :
    a.kind === "current-rating" || a.kind === "peak-rating" ? Math.round((a.progress / (a as any).n) * 100) :
    Math.min(100, Math.round((a.progress / Math.max(1, (a as any).n || 1)) * 100));
  return (
    <div className={`group relative rounded-xl p-3 transition hover:-translate-y-0.5 ${a.unlocked ? unlockedCls : lockedCls}`}
      title={a.chessBenefit}>
      <div className="flex items-start gap-2">
        <div className={`text-3xl leading-none ${a.unlocked ? "drop-shadow-lg" : "grayscale opacity-70"}`}>{a.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold truncate ${a.unlocked ? "text-white" : "text-ink-300"}`}>{a.name}</div>
          <div className={`text-[10px] uppercase tracking-wide ${a.unlocked ? "text-white/70" : "text-ink-500"}`}>{a.tier} · {a.category}</div>
        </div>
        {a.unlocked && <span className="text-[10px] font-semibold uppercase tracking-wider text-white/80">✓</span>}
      </div>
      <div className={`mt-2 text-[11px] leading-snug ${a.unlocked ? "text-white/85" : "text-ink-400"}`}>
        {a.chessBenefit}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
        <div className={`h-1 flex-1 overflow-hidden rounded-full ${a.unlocked ? "bg-white/20" : "bg-ink-800"}`}>
          <div className={`h-full rounded-full ${a.unlocked ? "bg-white" : "bg-brand-500"}`} style={{ width: `${Math.max(2, Math.min(100, isFinite(pct) ? pct : 0))}%` }} />
        </div>
        <span className={`tabular-nums ${a.unlocked ? "text-white/85" : "text-ink-500"}`}>{a.progressLabel}</span>
      </div>
    </div>
  );
}

/** Public gallery for any academy member. Renders 27 badges grouped by
 *  category, with lock/unlock state + progress bars + chess-skill copy. */
export function AchievementsGallery({ studentId }: { studentId: string }) {
  const q = useQuery({
    queryKey: ["academy-achievements", studentId],
    queryFn: () => get<Resp>(`/api/academy/achievements/${encodeURIComponent(studentId)}`),
    enabled: !!studentId,
    staleTime: 60_000,
  });
  const grouped = useMemo(() => {
    const map = new Map<string, Ach[]>();
    for (const a of q.data?.achievements ?? []) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return [...map.entries()];
  }, [q.data]);

  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-lg text-white">🎖️ Achievements</h2>
        <div className="text-xs text-ink-400">
          {q.isLoading ? "…" : (
            <>
              <span className="tabular-nums font-semibold text-amber-300">{q.data?.unlockedCount ?? 0}</span>
              <span className="mx-1">/</span>
              <span className="tabular-nums">{q.data?.total ?? 0}</span>
              <span className="ml-1">unlocked</span>
            </>
          )}
        </div>
      </div>
      {q.isLoading && <div className="text-xs text-ink-500">Loading badges…</div>}
      {grouped.length > 0 && (
        <div className="space-y-5">
          {grouped.map(([cat, list]) => (
            <div key={cat}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{CATEGORY_LABEL[cat] || cat}</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((a) => <AchBadge key={a.id} a={a} />)}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-[11px] text-ink-500">
        Each badge marks a real chess-skill milestone — 50 fork puzzles at 70% means you'll spot double attacks in real games.
      </p>
    </section>
  );
}
