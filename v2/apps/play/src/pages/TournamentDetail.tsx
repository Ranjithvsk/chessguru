// GET /t?id=<tournament-id> — full detail page with hero, info grid, action
// buttons (register/prospectus/maps/WhatsApp), contact card, prep CTA.
import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import { getTournament } from "../lib/api";
import type { Tournament } from "../lib/types";
import { RATING, FORMAT_LABEL, rupees, dateShort, dateLong } from "../lib/helpers";
import { useFavorites } from "../lib/useFavorites";

function InfoCard({ icon, label, value, sub }: any) {
  return (
    <div className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center gap-2 text-xs opacity-70 mb-1">
        <span>{icon}</span><span className="font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="font-semibold text-sm md:text-base leading-snug">{value || "—"}</div>
      {sub && <div className="text-xs opacity-60 mt-1">{sub}</div>}
    </div>
  );
}

export default function TournamentDetail() {
  const [search] = useSearchParams();
  const id = search.get("id");
  const [t, setT] = useState<Tournament | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setErr("No tournament ID"); return; }
    getTournament(id).then((d) => d?.error ? setErr(d.error) : setT(d)).catch(() => setErr("Load failed"));
  }, [id]);
  useEffect(() => { if (t?.name) document.title = `${t.name} — ChessGuru Play`; }, [t]);

  if (err) return (
    <>
      <Aurora /><Nav />
      <main className="min-h-[70vh] flex items-center justify-center text-center p-6">
        <div>
          <img src="/marketing/empty-state.webp" className="w-32 h-32 mx-auto rounded-2xl object-cover" />
          <h1 className="text-2xl font-black mt-4">Tournament not found</h1>
          <Link to="/" className="text-amber-300 mt-3 inline-block">← Back to all tournaments</Link>
        </div>
      </main>
      <Footer />
    </>
  );
  if (!t) return <><Aurora /><Nav /><main className="min-h-[70vh] flex items-center justify-center opacity-60">Loading…</main><Footer /></>;

  const { favs, toggle } = useFavorites();
  const isFav = favs.has(t._id);
  const onFav = async () => {
    const ok = await toggle(t._id);
    if (!ok) window.location.href = `https://chessguru.cc/login?next=${encodeURIComponent(window.location.href)}`;
  };
  const rat = RATING[t.rating_type ?? "UNRATED"] ?? RATING.UNRATED;
  const days = t.start_date ? Math.max(0, Math.ceil((new Date(t.start_date).getTime() - Date.now()) / 86_400_000)) : null;
  const ended = t.end_date ? new Date(t.end_date).getTime() < Date.now() - 86_400_000 : false;
  const isSame = t.start_date === t.end_date;
  const ageLabels = (t.age_categories || []).map((a) => (typeof a === "number" ? `U-${a}` : String(a)));
  const waText = `${t.name}\n📅 ${dateShort(t.start_date)}${!isSame ? " → " + dateShort(t.end_date) : ""}\n📍 ${t.city || t.location_raw || ""}, ${t.state || ""}\n🎟️ ${rupees(t.entry_fee_paise) || "TBD"}\n${t.prize_pool_paise ? "🏆 " + rupees(t.prize_pool_paise) + " prize pool" : ""}\n\nMore info + register: ${window.location.href}`;

  return (
    <>
      <Aurora /><Nav right={<Link to="/" className="text-sm opacity-80 hover:opacity-100">← All tournaments</Link>} />

      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={rat.hero} className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(10,15,28,0.4), rgba(10,15,28,0.95))" }} />
        </div>
        <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-10">
          <div className="flex items-start justify-between gap-4">
            <span className="inline-block rounded-full text-xs font-bold px-3 py-1 mb-4" style={{ background: rat.bg }}>{rat.label}</span>
            <button onClick={onFav} title={isFav ? "Bookmarked" : "Bookmark"}
                    className={`flex-none text-xl leading-none w-10 h-10 rounded-full border transition ${isFav ? "bg-rose-500/20 border-rose-400/60 text-rose-300" : "border-white/20 opacity-70 hover:opacity-100 hover:border-rose-400/40"}`}>
              {isFav ? "♥" : "♡"}
            </button>
          </div>
          <h1 className="font-black tracking-tight leading-tight max-w-3xl" style={{ fontSize: "clamp(28px,4vw,42px)" }}>{t.name}</h1>
          <div className="text-lg opacity-80 mt-2">Organized by <span className="font-semibold">{t.organizer_name || "—"}</span></div>
          {days != null && days <= 7 && (
            <div className="mt-4 inline-block text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full" style={{ background: "linear-gradient(135deg,#f472b6,#a855f7)" }}>
              {days === 0 ? "🔥 Today!" : days === 1 ? "🔥 Tomorrow" : `⏰ In ${days} days`}
            </div>
          )}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 -mt-4 relative">
        <div className="grid md:grid-cols-3 gap-4">
          <InfoCard icon="📅" label="Date" value={isSame ? dateLong(t.start_date) : `${dateLong(t.start_date)} → ${dateLong(t.end_date)}`} />
          <InfoCard icon="📍" label="Location" value={[t.city, t.district, t.state].filter(Boolean).join(", ") || t.location_raw} sub={t.location_raw && t.location_raw !== t.city ? t.location_raw : null} />
          <InfoCard icon="♟" label="Format" value={FORMAT_LABEL[t.format ?? ""] || t.format} />
          {t.entry_fee_paise != null && <InfoCard icon="🎟️" label="Entry fee" value={rupees(t.entry_fee_paise)} />}
          {t.prize_pool_paise != null && <InfoCard icon="🏆" label="Prize pool" value={rupees(t.prize_pool_paise)} />}
          {ageLabels.length > 0 && <InfoCard icon="👦" label="Categories" value={ageLabels.join(" · ")} />}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex flex-wrap gap-3">
          {t.register_url && (
            <a href={t.register_url} target="_blank" rel="noopener"
               className="flex-1 min-w-[200px] text-center rounded-full py-3.5 font-bold text-black text-base shadow-xl shadow-amber-500/30"
               style={{ background: "linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%)" }}>
              Register now →
            </a>
          )}
          {t.prospectus_url && <a href={t.prospectus_url} target="_blank" rel="noopener" className="rounded-full px-6 py-3.5 font-semibold text-sm border border-white/20 hover:bg-white/5">📄 Prospectus PDF</a>}
          {t.maps_url && <a href={t.maps_url} target="_blank" rel="noopener" className="rounded-full px-6 py-3.5 font-semibold text-sm border border-white/20 hover:bg-white/5">🗺️ Google Maps</a>}
          <a href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener"
             className="rounded-full px-6 py-3.5 font-semibold text-sm border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10">💬 Share on WhatsApp</a>
          {ended && (
            <a href={`https://S3.chess-results.com/tnrsearch.aspx?lan=1&search=${encodeURIComponent(t.name)}`}
               target="_blank" rel="noopener"
               className="rounded-full px-6 py-3.5 font-semibold text-sm border border-purple-400/40 text-purple-300 hover:bg-purple-500/10">
              🏆 Find results on chess-results.com →
            </a>
          )}
        </div>
      </section>

      {(t.contact_person || (t.contact_phones && t.contact_phones.length > 0)) && (
        <section className="max-w-5xl mx-auto px-6 pb-6">
          <div className="rounded-2xl border border-white/10 p-5" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-2" style={{ color: "#2dd4bf" }}>Contact</div>
            {t.contact_person && <div className="font-semibold">{t.contact_person}</div>}
            {(t.contact_phones || []).map((p) => <a key={p} href={`tel:${p}`} className="text-amber-300 hover:text-amber-200 mr-4">📞 {p}</a>)}
          </div>
        </section>
      )}

      <section className="max-w-5xl mx-auto px-6 py-10">
        <a href="https://chessguru.cc/" target="_blank" rel="noopener"
           className="block rounded-3xl border border-white/10 hover:border-amber-400/40 transition overflow-hidden group"
           style={{ background: "linear-gradient(180deg, rgba(251,191,36,0.06), rgba(0,0,0,0.4))" }}>
          <div className="grid md:grid-cols-2">
            <img src="/marketing/prep-bundle.webp" className="w-full h-full max-h-64 object-cover group-hover:scale-105 transition duration-500" />
            <div className="p-6 flex flex-col justify-center">
              <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#fbbf24" }}>Prep for this tournament</div>
              <h3 className="text-xl md:text-2xl font-black mt-1 mb-2">{days != null && days > 0 ? `${days} day${days === 1 ? "" : "s"} to prepare` : "Sharpen your game"}</h3>
              <p className="text-sm opacity-80">Daily puzzles at your rating, opening trainer, endgame drills — FREE with a ChessGuru account. No card, no spam.</p>
              <div className="mt-3 text-amber-300 font-semibold text-sm">Start prepping →</div>
            </div>
          </div>
        </a>
      </section>

      <Footer />
    </>
  );
}
