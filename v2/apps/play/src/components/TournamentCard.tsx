// Uniform tournament card used across landing, admin (row action), and future
// favorites list. Renders rating badge, dates, price, location, urgency tag,
// and links into the /t detail page rather than the register URL directly —
// detail page is where prep-bundle + WhatsApp share + prospectus lift value.
import { Link } from "react-router-dom";
import type { Tournament } from "../lib/types";
import { RATING, dateRange, rupees } from "../lib/helpers";
import { useFavorites } from "../lib/useFavorites";

export default function TournamentCard({ t }: { t: Tournament }) {
  const { favs, toggle } = useFavorites();
  const isFav = favs.has(t._id);
  async function onFav(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const ok = await toggle(t._id);
    if (!ok) window.location.href = `https://chessguru.cc/login?next=${encodeURIComponent(window.location.href)}`;
  }
  const rat = RATING[t.rating_type ?? "UNRATED"] ?? RATING.UNRATED;
  const days = t.start_date ? Math.max(0, Math.ceil((new Date(t.start_date).getTime() - Date.now()) / 86_400_000)) : null;
  const loc = [t.city, t.district, t.state].filter(Boolean).join(", ") || t.location_raw || "—";
  return (
    <Link
      to={`/t?id=${encodeURIComponent(t._id)}`}
      className="block rounded-2xl border border-[color:var(--border)] hover:border-amber-400/40 hover:-translate-y-0.5 transition p-4 group"
      style={{ background: "linear-gradient(180deg, var(--card-grad-a), var(--card-grad-b))" }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm md:text-base font-bold leading-tight line-clamp-2 group-hover:text-amber-300 transition">{t.name}</div>
          <div className="text-xs opacity-70 mt-1 truncate">{t.organizer_name || "—"}</div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-none">
          <span className="rounded-full text-[10px] font-bold px-2.5 py-1"
                style={{ background: rat.bg, color: t.rating_type && t.rating_type !== "UNRATED" ? "#fff" : "#cbd5e1" }}>
            {rat.label}
          </span>
          <button
            onClick={onFav} title={isFav ? "Remove bookmark" : "Bookmark"} aria-label="Bookmark"
            className={`text-lg leading-none w-8 h-8 rounded-full border transition ${isFav ? "bg-rose-500/20 border-rose-400/60 text-rose-300" : "border-[color:var(--border-strong)] opacity-60 hover:opacity-100 hover:border-rose-400/40"}`}
          >{isFav ? "♥" : "♡"}</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-y-2 text-xs opacity-90">
        <div className="flex items-center gap-1.5"><span className="opacity-60">📅</span><span>{dateRange(t.start_date, t.end_date)}</span></div>
        <div className="flex items-center gap-1.5"><span className="opacity-60">🏆</span><span>{rupees(t.prize_pool_paise) || "—"}</span></div>
        <div className="flex items-center gap-1.5 col-span-2 truncate"><span className="opacity-60">📍</span><span className="truncate">{loc}</span></div>
        {t.distance_km != null && (
          <div className="flex items-center gap-1.5 text-teal-300 font-semibold"><span>🧭</span><span>{t.distance_km} km from you</span></div>
        )}
        {t.entry_fee_paise != null && (
          <div className="flex items-center gap-1.5"><span className="opacity-60">🎟️</span><span>{rupees(t.entry_fee_paise)}</span></div>
        )}
      </div>
      {t.matched_players && t.matched_players.length > 0 && (
        <div className="mt-3 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "#c084fc" }}>
          <span>🎯</span>
          <span>{t.matched_players.length === 1
            ? `Matches ${t.matched_players[0].name} (${t.matched_players[0].age}y)`
            : `Matches ${t.matched_players.length} of your players`}</span>
        </div>
      )}
      {days != null && days <= 7 && (
        <div className="mt-2 text-[11px] font-bold text-amber-300 uppercase tracking-wider">
          {days === 0 ? "Today!" : days === 1 ? "Tomorrow" : `In ${days} days`}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-amber-300 group-hover:text-amber-200">View details →</span>
      </div>
    </Link>
  );
}
