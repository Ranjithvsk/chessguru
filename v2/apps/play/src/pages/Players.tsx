// /me/players — parent-managed roster of chess-playing kids. FIDE / AICF /
// state rating + DOB + home city power age-match personalization + rating-band
// suggestions later. Simple CRUD, no game-history yet (v2).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import { Input, Select } from "../components/FormControls";
import { useMe } from "../lib/useMe";
import { listPlayers, createPlayer, editPlayer, deletePlayer } from "../lib/api";
import { STATES } from "../lib/helpers";

interface Player {
  _id: string; name: string; dob?: string | null; gender?: "M"|"F"|"O" | null;
  fide_id?: string | null; aicf_id?: string | null; state_rating?: number | null;
  home_city?: string | null; home_state?: string | null;
}
const EMPTY = { name: "", dob: "", gender: "" as any, fide_id: "", aicf_id: "", state_rating: "", home_city: "", home_state: "Tamil Nadu" };
const age = (dob?: string | null) => {
  if (!dob) return null;
  const d = new Date(dob); if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
};

export default function Players() {
  const me = useMe();
  const [rows, setRows] = useState<Player[] | null>(null);
  const [edit, setEdit] = useState<any | null>(null);   // null = closed; object = form state (edit._id present → edit mode)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setRows(null);
    const r = await listPlayers();
    setRows(r.rows || []);
  }
  useEffect(() => { if (me?.loggedIn) load(); }, [me?.loggedIn]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const body = { ...edit, state_rating: edit.state_rating ? +edit.state_rating : null };
      const r = edit._id ? await editPlayer(edit._id, body) : await createPlayer(body);
      if (!r.ok) { setErr(r.error || "Save failed"); return; }
      setEdit(null); await load();
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Remove ${name}? This can't be undone.`)) return;
    await deletePlayer(id); load();
  }

  if (!me) return <><Aurora /><Nav /><main className="min-h-[70vh] flex items-center justify-center opacity-60">Loading…</main><Footer /></>;
  if (!me.loggedIn) return (
    <>
      <Aurora /><Nav />
      <main className="min-h-[70vh] flex items-center justify-center text-center p-6">
        <div>
          <img src="/marketing/player-profile.webp" className="w-32 h-32 mx-auto rounded-2xl object-cover" />
          <h1 className="text-2xl md:text-3xl font-black mt-4">Your player profile</h1>
          <p className="opacity-80 mt-2 max-w-md mx-auto">Sign in to save your kids' profiles — FIDE ID, ratings, categories — so we recommend tournaments they'll actually play.</p>
          <a href={`https://chessguru.cc/login?next=${encodeURIComponent(window.location.href)}`}
             className="inline-block mt-5 rounded-full px-5 py-2.5 text-black font-bold text-sm"
             style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>Sign in →</a>
        </div>
      </main>
      <Footer />
    </>
  );

  return (
    <>
      <Aurora /><Nav />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex flex-wrap items-end justify-between mb-8 gap-4">
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#c084fc" }}>Your players</div>
            <h1 className="text-3xl md:text-4xl font-black mt-1">Player profiles</h1>
            <p className="opacity-70 mt-2 text-sm max-w-xl">Add your kids (or yourself). We use age + rating to recommend the right tournaments and pre-fill registration forms.</p>
          </div>
          <button onClick={() => setEdit({ ...EMPTY })}
                  className="rounded-full px-5 py-2.5 text-black font-bold text-sm shadow-lg shadow-amber-500/25"
                  style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>+ Add player</button>
        </div>

        {!rows ? <div className="text-center opacity-60 py-10">Loading…</div> :
         rows.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-[color:var(--border)]" style={{ background: "var(--card-bg-lg)" }}>
            <img src="/marketing/persona-kid-ambitious.webp" className="mx-auto w-32 h-32 object-contain rounded-2xl" />
            <div className="mt-3 font-semibold">No players yet.</div>
            <div className="text-xs opacity-70 mt-1">Add your first player to unlock personalized recommendations.</div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {rows.map((p) => {
              const a = age(p.dob);
              return (
                <div key={p._id} className="rounded-2xl border border-[color:var(--border)] p-5" style={{ background: "linear-gradient(180deg, var(--card-grad-a), var(--card-grad-b))" }}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="text-lg font-black">{p.name}</div>
                      <div className="text-xs opacity-70 mt-0.5">
                        {a != null ? `${a} yrs` : "age not set"}
                        {p.gender && ` · ${p.gender === "M" ? "Boy" : p.gender === "F" ? "Girl" : "—"}`}
                        {(p.home_city || p.home_state) && ` · ${[p.home_city, p.home_state].filter(Boolean).join(", ")}`}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEdit({ ...p, dob: p.dob ? String(p.dob).slice(0, 10) : "", state_rating: p.state_rating ?? "" })}
                              className="text-xs px-2 py-1 rounded border border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]" title="Edit">✎</button>
                      <button onClick={() => remove(p._id, p.name)} className="text-xs px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-500/10" title="Delete">🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <StatChip label="FIDE" v={p.fide_id} color="#60a5fa" />
                    <StatChip label="AICF" v={p.aicf_id} color="#fb923c" />
                    <StatChip label="State" v={p.state_rating} color="#34d399" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {edit && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEdit(null)}>
            <form onSubmit={save} onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-lg rounded-3xl border border-[color:var(--border)] p-6 max-h-[90vh] overflow-y-auto"
                  style={{ background: "var(--modal-bg)" }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-black">{edit._id ? "Edit player" : "Add a player"}</h2>
                <button type="button" onClick={() => setEdit(null)} className="text-[color:var(--text-muted)] hover:text-white text-xl leading-none">×</button>
              </div>
              <div className="space-y-3">
                <Input label="Name" required value={edit.name} onChange={(e: any) => setEdit({ ...edit, name: e.target.value })} placeholder="Aarav Kumar" />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Date of birth" type="date" value={edit.dob} onChange={(e: any) => setEdit({ ...edit, dob: e.target.value })} help="For age-category matches" />
                  <Select label="Gender" value={edit.gender ?? ""} onChange={(e: any) => setEdit({ ...edit, gender: e.target.value || null })}
                          options={[{ value: "", label: "— skip —" }, { value: "M", label: "Boy" }, { value: "F", label: "Girl" }, { value: "O", label: "Other" }]} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input label="FIDE ID" value={edit.fide_id ?? ""} onChange={(e: any) => setEdit({ ...edit, fide_id: e.target.value })} placeholder="12345678" />
                  <Input label="AICF ID" value={edit.aicf_id ?? ""} onChange={(e: any) => setEdit({ ...edit, aicf_id: e.target.value })} placeholder="TN12345" />
                </div>
                <Input label="Current state / provisional rating" type="number" value={edit.state_rating ?? ""} onChange={(e: any) => setEdit({ ...edit, state_rating: e.target.value })} placeholder="1350" />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Home city" value={edit.home_city ?? ""} onChange={(e: any) => setEdit({ ...edit, home_city: e.target.value })} placeholder="Chennai" />
                  <Select label="Home state" value={edit.home_state ?? "Tamil Nadu"} onChange={(e: any) => setEdit({ ...edit, home_state: e.target.value })} options={STATES as any} />
                </div>
                {err && <div className="text-sm px-3 py-2 rounded-lg border border-rose-400/40 bg-rose-500/10 text-rose-300">{err}</div>}
                <button type="submit" disabled={busy}
                        className="w-full rounded-full py-3 font-bold text-black shadow-xl shadow-amber-500/30 text-sm disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%)" }}>
                  {busy ? "Saving…" : edit._id ? "Save changes" : "Add player →"}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
function StatChip({ label, v, color }: { label: string; v: any; color: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] p-2 text-center" style={{ background: "var(--card-bg-lg)" }}>
      <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color }}>{label}</div>
      <div className="font-bold mt-0.5 text-sm">{v != null && v !== "" ? String(v) : "—"}</div>
    </div>
  );
}
