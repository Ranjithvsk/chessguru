// /calendar — month grid, tournaments as chips on their start_date.
// Prev/next month nav, "Today" jump, filter by rating type. Click a chip → detail.
// Mobile: same grid but chip labels truncate more aggressively.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import { listTournaments } from "../lib/api";
import type { Tournament } from "../lib/types";
import { RATING } from "../lib/helpers";

type RatingFilter = "ALL" | "RATED" | "FIDE" | "AICF" | "STATE";
const FILTERS: Array<{ id: RatingFilter; label: string }> = [
  { id: "ALL", label: "All" }, { id: "RATED", label: "Only rated" },
  { id: "FIDE", label: "FIDE" }, { id: "AICF", label: "AICF" }, { id: "STATE", label: "State" },
];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// yyyy-mm-dd key so we can bucket tournaments per calendar cell.
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export default function CalendarPage() {
  const [rows, setRows] = useState<Tournament[] | null>(null);
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0,0,0,0); return d; });
  const [filter, setFilter] = useState<RatingFilter>("ALL");

  useEffect(() => {
    // Pull a wider set than /me/feed — 6-month lookahead, cap 400.
    listTournaments({ limit: "400" }).then((d) => setRows(d.rows || [])).catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === "ALL") return rows;
    if (filter === "RATED") return rows.filter((t) => ["FIDE","AICF","STATE"].includes(t.rating_type ?? ""));
    return rows.filter((t) => t.rating_type === filter);
  }, [rows, filter]);

  // Bucket tournaments by day. A multi-day tournament shows on its START_date cell.
  const byDay = useMemo(() => {
    const m = new Map<string, Tournament[]>();
    for (const t of filtered) {
      if (!t.start_date) continue;
      const k = dayKey(new Date(t.start_date));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return m;
  }, [filtered]);

  // Grid — 6 rows × 7 cols starting from the Sunday of the week containing day 1.
  const cells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const start = new Date(firstOfMonth);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());  // back to Sunday
    const out: Array<{ date: Date; inMonth: boolean; isToday: boolean }> = [];
    const today = new Date(); today.setUTCHours(0,0,0,0);
    const todayKey = dayKey(today);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      out.push({ date: d, inMonth: d.getUTCMonth() === cursor.getUTCMonth(), isToday: dayKey(d) === todayKey });
    }
    return out;
  }, [cursor]);

  const shift = (delta: number) => {
    const d = new Date(cursor); d.setUTCMonth(d.getUTCMonth() + delta); setCursor(d);
  };
  const jumpToday = () => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0,0,0,0); setCursor(d); };

  return (
    <>
      <Aurora /><Nav />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-end justify-between mb-6 gap-4">
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#2dd4bf" }}>By date</div>
            <h1 className="text-3xl md:text-4xl font-black mt-1">
              {MONTHS[cursor.getUTCMonth()]} {cursor.getUTCFullYear()}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="w-9 h-9 rounded-full border border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]" title="Previous month">‹</button>
            <button onClick={jumpToday} className="rounded-full px-3 py-1.5 text-xs font-semibold border border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]">Today</button>
            <button onClick={() => shift(1)} className="w-9 h-9 rounded-full border border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]" title="Next month">›</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition ${filter === f.id ? "text-black border-transparent" : "text-[color:var(--text-dim)] border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]"}`}
                    style={filter === f.id ? { background: "linear-gradient(135deg,#fbbf24,#f472b6)" } : {}}>{f.label}</button>
          ))}
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 md:gap-2 mb-1 text-[10px] md:text-xs font-semibold opacity-60 uppercase tracking-wider text-center">
          {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-1 md:gap-2">
          {cells.map(({ date, inMonth, isToday }) => {
            const k = dayKey(date);
            const day = date.getUTCDate();
            const items = byDay.get(k) || [];
            return (
              <div key={k}
                   className={`min-h-[80px] md:min-h-[110px] rounded-xl md:rounded-2xl border p-1.5 md:p-2 flex flex-col overflow-hidden ${inMonth ? "border-[color:var(--border)]" : "border-white/5 opacity-40"} ${isToday ? "ring-2 ring-amber-400/40" : ""}`}
                   style={{ background: isToday ? "rgba(251,191,36,0.06)" : "rgba(255,255,255,0.02)" }}>
                <div className={`text-[11px] md:text-xs font-bold mb-1 ${isToday ? "text-amber-300" : "opacity-70"}`}>{day}</div>
                <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                  {items.slice(0, 3).map((t) => {
                    const rat = RATING[t.rating_type ?? "UNRATED"] ?? RATING.UNRATED;
                    return (
                      <Link key={t._id} to={`/t?id=${encodeURIComponent(t._id)}`}
                            className="block rounded text-[10px] md:text-[11px] px-1.5 py-1 leading-tight hover:brightness-110 transition"
                            style={{ background: rat.bg }}
                            title={t.name}>
                        <div className="font-semibold truncate">{t.name}</div>
                        <div className="opacity-80 truncate">{t.city || t.state || t.organizer_name || ""}</div>
                      </Link>
                    );
                  })}
                  {items.length > 3 && (
                    <div className="text-[10px] opacity-70 pl-1">+{items.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-5 flex flex-wrap gap-3 text-xs opacity-80">
          {["FIDE","AICF","STATE","UNRATED"].map((k) => {
            const r = RATING[k as keyof typeof RATING];
            return (
              <div key={k} className="flex items-center gap-1.5">
                <span className="inline-block w-4 h-3 rounded" style={{ background: r.bg }} />
                <span>{r.label}</span>
              </div>
            );
          })}
        </div>
      </main>
      <Footer />
    </>
  );
}
