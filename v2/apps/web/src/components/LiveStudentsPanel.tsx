import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/api";

type LiveStudent = {
  _id: string;
  username: string;
  name?: string | null;
  lastSeen: string;
  currentPath: string;
};

/** Map a client-side route to a human-readable "what are they doing" label
 *  the coach can scan. Longest-prefix first — subroutes like
 *  `/study/openings/ruy-lopez` are described more specifically than `/study`. */
function activityFor(path: string): { emoji: string; label: string } {
  const p = (path || "/").replace(/\/+$/, "") || "/";
  const startsWith = (s: string) => p === s || p.startsWith(s + "/");
  if (startsWith("/study/openings"))       return { emoji: "📚", label: "Studying openings" };
  if (startsWith("/study/endgame"))        return { emoji: "♚", label: "Endgame trainer" };
  if (startsWith("/study/key-squares"))    return { emoji: "🎯", label: "Key squares" };
  if (startsWith("/study/opposition"))     return { emoji: "⚔️", label: "Opposition drill" };
  if (startsWith("/study/promote"))        return { emoji: "♟️", label: "Promote lesson" };
  if (startsWith("/study/notation"))       return { emoji: "✍️", label: "Notation trainer" };
  if (startsWith("/study/coordinates"))    return { emoji: "🧭", label: "Coordinates" };
  if (startsWith("/study/memory-palace"))  return { emoji: "🏛️", label: "Memory palace" };
  if (startsWith("/study/zugzwang"))       return { emoji: "🪤", label: "Zugzwang" };
  if (startsWith("/study/opening-memory")) return { emoji: "🧠", label: "Opening memory" };
  if (startsWith("/study/repertoire"))     return { emoji: "📖", label: "Repertoire" };
  if (startsWith("/study/daily"))          return { emoji: "🗓️", label: "Daily study" };
  if (startsWith("/study"))                return { emoji: "📘", label: "In study section" };
  if (startsWith("/puzzles"))              return { emoji: "🧩", label: "Solving puzzles" };
  if (startsWith("/blindfold"))            return { emoji: "🙈", label: "Blindfold puzzles" };
  if (startsWith("/play"))                 return { emoji: "♟️", label: "Playing a game" };
  if (startsWith("/class-v2"))             return { emoji: "🎥", label: "In a live class" };
  if (startsWith("/broadcasts"))           return { emoji: "📡", label: "Watching broadcast" };
  if (startsWith("/history"))              return { emoji: "📜", label: "Reviewing history" };
  if (startsWith("/dashboard"))            return { emoji: "📊", label: "On dashboard" };
  if (startsWith("/board-editor"))         return { emoji: "📷", label: "Scanning a position" };
  if (startsWith("/book"))                 return { emoji: "📗", label: "Reading book" };
  if (startsWith("/my-games"))             return { emoji: "🎮", label: "Reviewing games" };
  if (startsWith("/academy"))              return { emoji: "🏛️", label: "On academy page" };
  if (p === "/" || startsWith("/login") || startsWith("/register")) return { emoji: "🚪", label: "On landing" };
  return { emoji: "•", label: p };
}

function secondsAgo(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/** Coach-facing "who's online right now" panel for /academy. Reads
 *  /api/academy/presence — freshness window is 3 minutes on the server. */
export function LiveStudentsPanel({ enabled }: { enabled: boolean }) {
  const q = useQuery({
    queryKey: ["academy-presence"],
    queryFn: () => get<LiveStudent[]>("/api/academy/presence"),
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const rows = q.data ?? [];
  const grouped = useMemo(() => {
    const byActivity = new Map<string, { emoji: string; label: string; students: LiveStudent[] }>();
    for (const s of rows) {
      const a = activityFor(s.currentPath);
      const key = a.label;
      if (!byActivity.has(key)) byActivity.set(key, { emoji: a.emoji, label: a.label, students: [] });
      byActivity.get(key)!.students.push(s);
    }
    return [...byActivity.values()].sort((a, b) => b.students.length - a.students.length);
  }, [rows]);

  return (
    <section className="rounded-xl2 border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-ink-900/60 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${rows.length > 0 ? "animate-ping bg-emerald-400 opacity-75" : ""}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${rows.length > 0 ? "bg-emerald-500" : "bg-ink-600"}`} />
          </span>
          <h2 className="font-display text-lg text-white">Students online now</h2>
          <span className="tabular-nums text-sm text-emerald-300">{rows.length}</span>
        </div>
        <span className="text-[11px] text-ink-500">refreshed every 30s</span>
      </div>

      {q.isLoading && rows.length === 0 && (
        <div className="text-xs text-ink-500">Checking…</div>
      )}
      {!q.isLoading && rows.length === 0 && (
        <div className="text-xs text-ink-400">No students online right now. They'll show up here as soon as someone opens the site.</div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.label}>
              <div className="mb-1.5 flex items-baseline gap-2 text-xs uppercase tracking-wide text-emerald-300">
                <span>{g.emoji}</span><span>{g.label}</span>
                <span className="tabular-nums text-emerald-400/70">{g.students.length}</span>
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {g.students.map((s) => (
                  <li key={s._id} className="flex items-baseline justify-between gap-2 rounded-lg border border-ink-700/60 bg-ink-900/60 px-2.5 py-1.5">
                    <Link
                      to={`/academy/students/${encodeURIComponent(s._id)}/performance`}
                      className="truncate text-sm font-medium text-white hover:text-brand-300"
                      title={`@${s.username} · ${s.currentPath}`}
                    >
                      {s.name || s.username}
                    </Link>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-400">{secondsAgo(s.lastSeen)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
