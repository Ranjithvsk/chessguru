// /admin — super-admin dashboard for reviewing submissions + curating tournaments.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminList, adminStats, adminVerify, adminHide, adminUnhide, adminDelete } from "../lib/api";
import { rupees, dateShortYr, ago } from "../lib/helpers";

type Tab = "selfserve" | "scraped" | "hidden" | "all";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "selfserve", label: "Self-serve submissions" },
  { id: "scraped",   label: "easypaychess (scraped)" },
  { id: "hidden",    label: "Hidden" },
  { id: "all",       label: "All" },
];

export default function Admin() {
  const [tab, setTab] = useState<Tab>("selfserve");
  const [stats, setStats] = useState<any>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null); setErr(null);
    try {
      const [s, r] = await Promise.all([
        adminStats(),
        adminList(
          tab === "selfserve" ? { source: "self-serve", limit: "100" } :
          tab === "hidden"    ? { hidden: "1",         limit: "100" } :
          tab === "scraped"   ? { source: "easypaychess", limit: "100" } :
                                { limit: "200" }
        ),
      ]);
      if (s.error) { setErr(s.error === "Forbidden" ? "You must be signed in as a super-admin to see this page." : s.error); return; }
      setStats(s); setRows(r.rows || []);
    } catch (e: any) {
      setErr("You must be signed in as a super-admin to see this page.");
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, kind: "verify" | "hide" | "unhide" | "delete") {
    setBusyId(id);
    const fn = kind === "verify" ? adminVerify : kind === "hide" ? adminHide : kind === "unhide" ? adminUnhide : adminDelete;
    await fn(id).catch(() => null);
    setBusyId(null);
    load();
  }

  if (err) return (
    <main className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-black">🔒 Forbidden</h1>
        <p className="mt-2 opacity-70 max-w-md">{err}</p>
        <a href="https://chessguru.cc/login" className="inline-block mt-4 rounded-full px-5 py-2.5 text-black font-bold" style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>Sign in →</a>
      </div>
    </main>
  );

  return (
    <>
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-black/40 border-b border-white/10 py-3 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg">
            <span style={{ color: "#fbbf24" }}>♟</span><span>ChessGuru</span>
            <span className="text-xs font-normal opacity-60 border border-white/20 rounded-full px-2 py-0.5 ml-1">Play · Admin</span>
          </Link>
          <Link to="/" className="text-sm opacity-80 hover:opacity-100">← Site</Link>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-6">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
            {[
              { l: "Total", v: stats.total, c: "#fbbf24" },
              { l: "Upcoming", v: stats.upcoming, c: "#2dd4bf" },
              { l: "Self-serve", v: stats.self_serve, c: "#c084fc" },
              { l: "Pending review", v: stats.pending_review, c: "#f472b6" },
              { l: "Hidden", v: stats.hidden, c: "#f87171" },
              { l: "Geocoded", v: stats.geocoded, c: "#60a5fa" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="text-xs uppercase tracking-wider opacity-70">{s.l}</div>
                <div className="text-2xl font-black mt-1" style={{ color: s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mb-4">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition ${tab === t.id ? "text-black border-transparent" : "text-white/80 border-white/20 hover:bg-white/5"}`}
                    style={tab === t.id ? { background: "linear-gradient(135deg,#fbbf24,#f472b6)" } : {}}>{t.label}</button>
          ))}
        </div>
        {!rows ? (
          <div className="text-center opacity-60 py-10">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-10 opacity-70">No tournaments in this view.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider opacity-70" style={{ background: "rgba(255,255,255,0.03)" }}>
                <tr>{["Name", "Organizer", "Where", "When", "Rating", "Fee", "Prize", "Source", "Status", "Actions"].map((c) => <th key={c} className="px-3 py-2.5 font-semibold">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2.5 font-semibold max-w-xs truncate">{r.name}</td>
                    <td className="px-3 py-2.5 opacity-80 max-w-[160px] truncate">{r.organizer_name || "—"}</td>
                    <td className="px-3 py-2.5 opacity-80 max-w-[160px] truncate">{[r.city, r.state].filter(Boolean).join(", ") || r.location_raw || "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{dateShortYr(r.start_date)}</td>
                    <td className="px-3 py-2.5">{r.rating_type || "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{rupees(r.entry_fee_paise) || "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{rupees(r.prize_pool_paise) || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <div>{r.source}</div>
                      {r.submitted_at && <div className="opacity-60">{ago(r.submitted_at)}</div>}
                      {r.scraped_at && !r.submitted_at && <div className="opacity-60">{ago(r.scraped_at)}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.hidden ? <span className="text-rose-300">hidden</span> :
                       r.submission_status === "VERIFIED" ? <span className="text-emerald-300">verified ✓</span> :
                       r.submission_status === "PENDING_REVIEW" ? <span className="text-amber-300">pending</span> :
                       <span className="opacity-60">—</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {busyId === r._id ? <span className="opacity-60 text-xs">…</span> : (
                        <div className="flex gap-1">
                          <a href={`/t?id=${encodeURIComponent(r._id)}`} target="_blank" rel="noopener" className="text-xs px-2 py-1 rounded border border-white/20 hover:bg-white/5" title="View">👁</a>
                          {r.submission_status !== "VERIFIED" && <button onClick={() => act(r._id, "verify")} className="text-xs px-2 py-1 rounded border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10" title="Verify">✓</button>}
                          {r.hidden
                            ? <button onClick={() => act(r._id, "unhide")} className="text-xs px-2 py-1 rounded border border-teal-400/40 text-teal-300 hover:bg-teal-500/10" title="Unhide">↑</button>
                            : <button onClick={() => act(r._id, "hide")}   className="text-xs px-2 py-1 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-500/10" title="Hide">↓</button>}
                          <button onClick={() => { if (confirm(`Delete ${r.name}?`)) act(r._id, "delete"); }} className="text-xs px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-500/10" title="Delete">🗑</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
