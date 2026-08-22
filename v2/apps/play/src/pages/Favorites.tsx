// /me/favorites — the parent's saved tournaments. Empty state nudges them to
// browse; not-signed-in state nudges to login.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import TournamentCard from "../components/TournamentCard";
import { useMe } from "../lib/useMe";
import { listFavorites } from "../lib/api";
import { subscribeToPush } from "../lib/push";
import type { Tournament } from "../lib/types";

export default function Favorites() {
  const me = useMe();
  const [rows, setRows] = useState<Tournament[] | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  async function enablePush() {
    const r = await subscribeToPush();
    setPushMsg(r.ok ? "🔔 Push alerts enabled — you'll get a nudge 3 days + 24h before each bookmark." : "❌ " + (r.reason || "Enable failed"));
  }
  useEffect(() => {
    if (me?.loggedIn) listFavorites().then((r) => setRows(r.rows || [])).catch(() => setRows([]));
  }, [me?.loggedIn]);

  if (!me) return <><Aurora /><Nav /><main className="min-h-[70vh] flex items-center justify-center opacity-60">Loading…</main><Footer /></>;

  if (!me.loggedIn) return (
    <>
      <Aurora /><Nav />
      <main className="min-h-[70vh] flex items-center justify-center text-center p-6">
        <div>
          <img src="/marketing/success-bookmark.webp" className="w-32 h-32 mx-auto rounded-2xl object-cover" />
          <h1 className="text-2xl md:text-3xl font-black mt-4">Bookmark your tournaments</h1>
          <p className="opacity-80 mt-2 max-w-md mx-auto">Sign in to save tournaments and get email alerts before each one starts.</p>
          <a href={`https://chessguru.cc/login?next=${encodeURIComponent(window.location.href)}`}
             className="inline-block mt-5 rounded-full px-5 py-2.5 text-black font-bold text-sm"
             style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>Sign in →</a>
          <div className="text-xs opacity-60 mt-3">No ChessGuru account? Creating one takes 20 seconds.</div>
        </div>
      </main>
      <Footer />
    </>
  );

  return (
    <>
      <Aurora /><Nav />
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#f472b6" }}>Saved</div>
            <h1 className="text-3xl md:text-4xl font-black mt-1">Your bookmarked tournaments</h1>
            <p className="opacity-70 mt-2">We'll email you 3 days + 24 hours before each starts.</p>
          </div>
          {rows && rows.length > 0 && (
            <button onClick={enablePush}
                    className="rounded-full px-4 py-2 text-sm font-bold border border-amber-400/40 text-amber-300 hover:bg-amber-500/10">
              🔔 Also enable push alerts
            </button>
          )}
        </div>
        {pushMsg && (
          <div className={`mb-4 text-sm px-4 py-3 rounded-xl border ${pushMsg.startsWith("🔔") ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : "border-rose-400/40 bg-rose-500/10 text-rose-300"}`}>
            {pushMsg}
          </div>
        )}
        {!rows ? <div className="text-center opacity-60 py-10">Loading…</div> :
         rows.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-white/10" style={{ background: "rgba(255,255,255,0.02)" }}>
            <img src="/marketing/empty-state.webp" className="mx-auto w-32 h-32 object-contain opacity-80" />
            <div className="mt-3 font-semibold">No bookmarks yet.</div>
            <div className="text-xs opacity-70 mt-1">Tap the ♡ on any tournament card to save it.</div>
            <Link to="/" className="inline-block mt-5 rounded-full px-5 py-2 text-black font-bold text-sm" style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>Browse tournaments →</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((t) => <TournamentCard key={t._id} t={t} />)}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
