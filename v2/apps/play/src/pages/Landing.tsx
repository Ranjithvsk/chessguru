// Home landing — geo-cascade rated + all upcoming, category tiles, growth CTAs.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import TournamentCard from "../components/TournamentCard";
import { feed as apiFeed, geolocatePincode, ratingRecs as apiRatingRecs } from "../lib/api";
import type { Tournament } from "../lib/types";

interface Geo { lat?: number; lng?: number; state?: string; district?: string; city?: string }

// Category tile config — jewel-tone gradient per tile matches the Gemini art.
const TILES = [
  { img: "/marketing/cat-fide-rated.webp",    title: "FIDE Rated",        blurb: "International rating points", grad: "from-blue-500/40 to-indigo-600/20" },
  { img: "/marketing/cat-aicf-rated.webp",    title: "AICF Rated",        blurb: "National rating events",       grad: "from-orange-500/40 to-amber-600/20" },
  { img: "/marketing/cat-state-rated.webp",   title: "State Rated",       blurb: "Regional stepping stones",     grad: "from-emerald-500/40 to-teal-600/20" },
  { img: "/marketing/cat-weekend-rapid.webp", title: "Weekend Rapid",     blurb: "Sat–Sun rapid formats",        grad: "from-pink-500/40 to-rose-600/20" },
  { img: "/marketing/cat-blitz.webp",         title: "Blitz",             blurb: "Fast & fierce",                grad: "from-red-500/40 to-purple-600/20" },
  { img: "/marketing/cat-youth.webp",         title: "Youth (U-9/11/13)", blurb: "Age-category events",          grad: "from-fuchsia-500/40 to-violet-600/20" },
  { img: "/marketing/cat-open.webp",          title: "Open",              blurb: "All ratings welcome",          grad: "from-amber-500/40 to-orange-600/20" },
];

const FILTERS = [
  { id: "ALL",   label: "All" },
  { id: "RATED", label: "Only rated" },
  { id: "FIDE",  label: "FIDE" },
  { id: "AICF",  label: "AICF" },
  { id: "STATE", label: "State" },
] as const;
type Filter = typeof FILTERS[number]["id"];

export default function Landing() {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [pincode, setPincode] = useState("");
  const [rated, setRated] = useState<Tournament[] | null>(null);
  const [nearby, setNearby] = useState<Tournament[] | null>(null);
  const [playersCount, setPlayersCount] = useState<number>(0);
  const [recs, setRecs] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  // On mount: try browser geo. User can also enter pincode manually.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, { timeout: 4000 }
    );
  }, []);

  useEffect(() => {
    apiFeed({ lat: geo?.lat, lng: geo?.lng, state: geo?.state, district: geo?.district })
      .then((d: any) => { setRated(d.rated || []); setNearby(d.nearby || []); setPlayersCount(d.players_count || 0); })
      .catch(() => { setRated([]); setNearby([]); });
  }, [geo?.lat, geo?.lng, geo?.state, geo?.district]);

  // Rating-band recs — signed-in users with player profiles. Fires once on mount.
  useEffect(() => {
    apiRatingRecs().then((d) => setRecs(d.players || [])).catch(() => setRecs([]));
  }, []);

  async function submitPincode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pincode)) return;
    const r = await geolocatePincode(pincode).catch(() => null);
    if (r?.ok) setGeo(r);
  }

  const filtered = useMemo(() => {
    if (!nearby) return [];
    if (filter === "ALL") return nearby;
    if (filter === "RATED") return nearby.filter((t) => ["FIDE", "AICF", "STATE"].includes(t.rating_type ?? ""));
    return nearby.filter((t) => t.rating_type === filter);
  }, [nearby, filter]);

  return (
    <>
      <Aurora />
      <Nav />

      {/* Hero */}
      <section className="relative overflow-hidden py-16 md:py-20 px-6">
        <div className="relative max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-5 text-xs font-medium border border-amber-400/30"
                 style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24" }}>
              ✨ Every India tournament · nearby first · one tap register
            </div>
            <h1 className="font-black tracking-tight leading-tight mb-5" style={{ fontSize: "clamp(36px,5.5vw,60px)" }}>
              Where India{" "}
              <span style={{ background: "linear-gradient(135deg,#fbbf24 0%,#f472b6 60%,#a855f7 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>plays chess</span>.
            </h1>
            <p className="text-base md:text-lg opacity-80 mb-6 max-w-xl">
              Discover FIDE, AICF and state-rated tournaments across the country. Nearby ones show first — Chennai, Bengaluru, or anywhere. Register in one tap.
            </p>
            <div className="rounded-2xl border border-white/10 p-4 mb-2" style={{ background: "rgba(255,255,255,0.03)" }}>
              {geo?.state ? (
                <div className="text-sm">
                  <span className="opacity-70">Showing tournaments near </span>
                  <span className="font-semibold text-teal-300">{[geo.city, geo.district, geo.state].filter(Boolean).join(", ")}</span>
                  {" · "}
                  <button onClick={() => setGeo(null)} className="opacity-70 hover:opacity-100 underline text-xs">Change</button>
                </div>
              ) : geo ? (
                <div className="text-sm opacity-80">📍 Location detected — sorting by distance</div>
              ) : (
                <form onSubmit={submitPincode} className="flex items-center gap-2 text-sm">
                  <span className="opacity-70">📍 Your pincode for nearby tournaments:</span>
                  <input value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                         placeholder="600001"
                         className="flex-1 max-w-[140px] rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none" />
                  <button type="submit" className="rounded-lg px-3 py-1.5 text-black text-xs font-bold" style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>Go</button>
                </form>
              )}
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 rounded-3xl blur-2xl opacity-40" style={{ background: "linear-gradient(135deg,#f59e0b,#a855f7)" }} />
            <img src="/marketing/hero-tournament.webp" alt="" className="relative rounded-3xl shadow-2xl w-full" />
          </div>
        </div>
      </section>

      {/* Personalization prompt — no player profile yet + no bookmarks yet = obvious upsell */}
      {playersCount === 0 && (
        <section className="max-w-7xl mx-auto px-6 pt-4">
          <Link to="/me/players"
                className="block rounded-2xl border border-white/10 hover:border-purple-400/40 transition p-4 md:p-5 flex items-center gap-4"
                style={{ background: "linear-gradient(180deg, rgba(168,85,247,0.08), rgba(0,0,0,0.4))" }}>
            <div className="text-3xl">🎯</div>
            <div className="flex-1">
              <div className="font-bold text-sm md:text-base">Add your kids' player profiles</div>
              <div className="text-xs opacity-70 mt-0.5">We'll boost tournaments that match their age category — no more scrolling U-19 events when you have a U-9 player.</div>
            </div>
            <div className="hidden md:block text-sm font-semibold" style={{ color: "#c084fc" }}>Add player →</div>
          </Link>
        </section>
      )}

      {/* Rating-band recs — one strip per player when signed in with player profiles. */}
      {recs && recs.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 pt-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recs.map((r) => (
              <Link key={r.player_id} to="/me/players"
                    className="block rounded-2xl border border-white/10 hover:border-purple-400/40 transition p-4"
                    style={{ background: "linear-gradient(180deg, rgba(168,85,247,0.08), rgba(0,0,0,0.4))" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#c084fc" }}>For {r.player_name}</div>
                    <div className="text-2xl font-black mt-1">
                      <span style={{ color: "#fbbf24" }}>{r.rated_count}</span>
                      <span className="text-sm opacity-80 font-normal"> rated event{r.rated_count === 1 ? "" : "s"} in next 60 days</span>
                    </div>
                    <div className="text-xs opacity-70 mt-1">
                      {r.rating ? `Rating ${r.rating}` : "Add rating to filter by band"}
                      {r.home_state && ` · ${r.home_state}`}
                    </div>
                  </div>
                  <div className="text-3xl">🎯</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Rated near you strip */}
      {rated && rated.length > 0 && (
        <section className="border-y border-white/10 py-10 px-6" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="max-w-7xl mx-auto">
            <div className="flex items-end justify-between mb-6 gap-4">
              <div>
                <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#fbbf24" }}>Rated · Earn rating points</div>
                <h2 className="text-2xl md:text-3xl font-black mt-1">Rated tournaments near you</h2>
              </div>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rated.slice(0, 6).map((t) => <TournamentCard key={t._id} t={t} />)}
            </div>
          </div>
        </section>
      )}

      {/* Category tiles */}
      <section className="py-14 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#a855f7" }}>Browse by category</div>
          <h2 className="text-2xl md:text-4xl font-black mt-1">What kind of tournament?</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {TILES.map((tile) => (
            <div key={tile.title} className="relative rounded-3xl overflow-hidden border border-white/10 hover:border-white/25 transition aspect-[16/10] group cursor-pointer">
              <img src={tile.img} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" />
              <div className={`absolute inset-0 bg-gradient-to-br ${tile.grad}`} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(10,15,28,0.9) 0%, transparent 55%)" }} />
              <div className="absolute bottom-4 left-5 right-5">
                <div className="text-xl md:text-2xl font-black">{tile.title}</div>
                <div className="text-xs opacity-80 mt-1">{tile.blurb}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* All upcoming */}
      <section className="py-14 px-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-end justify-between mb-6 gap-4">
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#2dd4bf" }}>Upcoming · sorted for you</div>
            <h2 className="text-2xl md:text-3xl font-black mt-1">All tournaments · nearby first</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                      className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition ${filter === f.id ? "text-black border-transparent" : "text-white/80 border-white/20 hover:bg-white/5"}`}
                      style={filter === f.id ? { background: "linear-gradient(135deg,#fbbf24,#f472b6)" } : {}}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {!nearby ? (
          <div className="text-center opacity-60 py-10">Loading tournaments…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-white/10" style={{ background: "rgba(255,255,255,0.02)" }}>
            <img src="/marketing/empty-state.webp" className="mx-auto w-32 h-32 object-contain opacity-80" />
            <div className="mt-3 font-semibold">No tournaments match this filter yet.</div>
            <div className="text-xs opacity-70 mt-1">We add more every day — try changing the filter.</div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => <TournamentCard key={t._id} t={t} />)}
          </div>
        )}
      </section>

      {/* Growth CTAs */}
      <section className="py-14 px-6 max-w-7xl mx-auto">
        <div className="grid md:grid-cols-2 gap-6">
          <a href="https://chessguru.cc/" target="_blank" rel="noopener"
             className="block rounded-3xl border border-white/10 hover:border-amber-400/40 transition overflow-hidden group"
             style={{ background: "linear-gradient(180deg, rgba(251,191,36,0.06), rgba(0,0,0,0.4))" }}>
            <img src="/marketing/prep-bundle.webp" className="w-full h-40 object-cover group-hover:scale-105 transition duration-500" />
            <div className="p-6">
              <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#fbbf24" }}>Free for students</div>
              <h3 className="text-xl md:text-2xl font-black mt-1 mb-2">Prep for your next tournament free</h3>
              <p className="text-sm opacity-80">Daily puzzles at your rating, opening trainer, endgame drills. Free ChessGuru account, no card.</p>
              <div className="mt-4 text-amber-300 font-semibold text-sm">Start prepping →</div>
            </div>
          </a>
          <a href="https://chessguru.cc/signup-academy" target="_blank" rel="noopener"
             className="block rounded-3xl border border-white/10 hover:border-amber-400/40 transition overflow-hidden group"
             style={{ background: "linear-gradient(180deg, rgba(168,85,247,0.06), rgba(0,0,0,0.4))" }}>
            <img src="/marketing/coach-placement.webp" className="w-full h-40 object-cover group-hover:scale-105 transition duration-500" />
            <div className="p-6">
              <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#c084fc" }}>For chess academies</div>
              <h3 className="text-xl md:text-2xl font-black mt-1 mb-2">Run your academy on ChessGuru</h3>
              <p className="text-sm opacity-80">Coaches, students, live classes, fees, attendance. 90 days free, ₹1,000/mo after.</p>
              <div className="mt-4 font-semibold text-sm" style={{ color: "#c084fc" }}>Start 90-day trial →</div>
            </div>
          </a>
        </div>
      </section>

      <Footer />
    </>
  );
}
