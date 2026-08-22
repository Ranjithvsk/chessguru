// /submit-tournament — 60-sec self-serve tournament listing form.
import { useState } from "react";
import { Link } from "react-router-dom";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import { Input, Select, Chip } from "../components/FormControls";
import { submitTournament } from "../lib/api";
import { STATES } from "../lib/helpers";

const AGE_OPTS: Array<number | string> = [7, 9, 11, 13, 15, 17, 19, "OPEN", "GIRLS", "WOMEN", "SENIOR"];

export default function Submit() {
  const [f, setF] = useState({
    name: "", organizer_name: "", start_date: "", end_date: "",
    format: "RAPID", rating_type: "STATE", age_categories: [] as Array<number | string>,
    venue: "", city: "", state: "Tamil Nadu",
    entry_fee_rupees: "", prize_pool_rupees: "",
    contact_person: "", contact_phone: "", contact_email: "",
    prospectus_url: "", register_url: "", maps_url: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState("");
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const toggleAge = (a: any) => setF({ ...f, age_categories: f.age_categories.includes(a) ? f.age_categories.filter((x) => x !== a) : [...f.age_categories, a] });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await submitTournament({ ...f, end_date: f.end_date || f.start_date });
      if (r.ok) setDone(r);
      else setErr(r.error || "Submit failed");
    } catch { setErr("Network error — please try again."); }
    finally { setBusy(false); }
  }

  if (done) {
    const waHref = `https://wa.me/?text=${encodeURIComponent("I've listed my chess tournament on ChessGuru Play — free, India-wide reach: https://play.chessguru.cc/")}`;
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center">
          <img src="/marketing/success-bookmark.webp" className="w-40 h-40 mx-auto rounded-2xl object-cover" />
          <h1 className="text-2xl md:text-3xl font-black mt-6">🎉 Live!</h1>
          <p className="opacity-80 mt-2">{done.message}</p>
          <div className="mt-6 flex flex-wrap gap-3 justify-center">
            <Link to="/" className="rounded-full px-5 py-2.5 text-black font-bold text-sm" style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>See my tournament →</Link>
            <a href={waHref} target="_blank" rel="noopener" className="rounded-full px-5 py-2.5 font-bold text-sm border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10">💬 Share on WhatsApp</a>
          </div>
          <div className="mt-10 rounded-2xl border border-[color:var(--border)] p-5 text-left" style={{ background: "linear-gradient(180deg, rgba(168,85,247,0.06), rgba(0,0,0,0.4))" }}>
            <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#c084fc" }}>Also for you</div>
            <h3 className="font-bold mt-1 mb-2">Do you run a chess academy?</h3>
            <p className="text-sm opacity-80">Free 90-day trial of ChessGuru academy manager — students, coaches, fees, live classes. ₹1,000/month after.</p>
            <a href="https://chessguru.cc/signup-academy" target="_blank" rel="noopener" className="inline-block mt-3 text-amber-300 font-semibold text-sm">Start free trial →</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <Aurora /><Nav right={<Link to="/" className="text-sm opacity-80 hover:opacity-100">← Back</Link>} />
      <main className="max-w-3xl mx-auto px-6 py-10 md:py-14">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-4 text-xs font-medium border border-amber-400/30" style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24" }}>
            ✨ Free · 60-second listing · India-wide reach
          </div>
          <h1 className="text-3xl md:text-5xl font-black mb-3">List your tournament</h1>
          <p className="opacity-80 max-w-xl mx-auto">Reach parents and players across India. Free, unlimited listings. We handle discovery — you handle the tournament.</p>
        </div>
        <form onSubmit={submit} className="space-y-6 rounded-3xl border border-[color:var(--border)] p-6 md:p-8" style={{ background: "linear-gradient(180deg, var(--card-grad-a), var(--card-grad-deep))" }}>
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-3" style={{ color: "#2dd4bf" }}>Tournament</div>
            <div className="space-y-4">
              <Input label="Tournament name" required value={f.name} onChange={set("name")} placeholder="e.g. XYZ Academy 5th State-Level Rapid 2026" />
              <Input label="Organizer / Academy name" required value={f.organizer_name} onChange={set("organizer_name")} placeholder="e.g. XYZ Chess Academy" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Start date" required type="date" value={f.start_date} onChange={set("start_date")} />
                <Input label="End date" type="date" value={f.end_date} onChange={set("end_date")} help="Same as start if 1-day event" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Format" required value={f.format} onChange={set("format")} options={["CLASSICAL", "RAPID", "BLITZ"]} />
                <Select label="Rating type" required value={f.rating_type} onChange={set("rating_type")} options={[
                  { value: "FIDE", label: "FIDE Rated" }, { value: "AICF", label: "AICF Rated" },
                  { value: "STATE", label: "State Rated" }, { value: "UNRATED", label: "Unrated / Prize" }]} />
              </div>
              <div>
                <span className="text-xs font-semibold opacity-80 mb-2 block">Age categories</span>
                <div className="flex flex-wrap gap-2">
                  {AGE_OPTS.map((a) => <Chip key={a} label={typeof a === "number" ? `U-${a}` : a} active={f.age_categories.includes(a)} onClick={() => toggleAge(a)} />)}
                </div>
              </div>
            </div>
          </div>
          <div className="pt-2 border-t border-[color:var(--border)]">
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-3 mt-4" style={{ color: "#a855f7" }}>Location</div>
            <div className="space-y-4">
              <Input label="Venue name" value={f.venue} onChange={set("venue")} placeholder="e.g. XYZ Matric School Hall" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="City / Town" required value={f.city} onChange={set("city")} placeholder="Bengaluru" />
                <Select label="State" required value={f.state} onChange={set("state")} options={STATES} />
              </div>
              <Input label="Google Maps link" value={f.maps_url} onChange={set("maps_url")} placeholder="https://maps.app.goo.gl/... (optional but recommended)" />
            </div>
          </div>
          <div className="pt-2 border-t border-[color:var(--border)]">
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-3 mt-4" style={{ color: "#fbbf24" }}>Fees & prizes</div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Entry fee (₹)" type="number" min="0" value={f.entry_fee_rupees} onChange={set("entry_fee_rupees")} placeholder="400" />
              <Input label="Total prize pool (₹)" type="number" min="0" value={f.prize_pool_rupees} onChange={set("prize_pool_rupees")} placeholder="25000 (optional)" />
            </div>
          </div>
          <div className="pt-2 border-t border-[color:var(--border)]">
            <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-3 mt-4" style={{ color: "#f472b6" }}>Contact & links</div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Contact person" value={f.contact_person} onChange={set("contact_person")} placeholder="Mr. Amarnath" />
                <Input label="Phone (WhatsApp)" required type="tel" value={f.contact_phone} onChange={set("contact_phone")} placeholder="9876543210" />
              </div>
              <Input label="Email" type="email" value={f.contact_email} onChange={set("contact_email")} placeholder="you@example.com" help="For clarification & tournament updates" />
              <Input label="Prospectus PDF link" value={f.prospectus_url} onChange={set("prospectus_url")} placeholder="https://... (Google Drive share link OK)" />
              <Input label="Registration page link" value={f.register_url} onChange={set("register_url")} placeholder="https://easypaychess.com/... or your own page" />
            </div>
          </div>
          {err && <div className="text-sm px-4 py-3 rounded-xl border border-rose-400/40 bg-rose-500/10 text-rose-300">{err}</div>}
          <button type="submit" disabled={busy}
                  className="w-full rounded-full py-3.5 font-bold text-black shadow-xl shadow-amber-500/30 text-base disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%)" }}>
            {busy ? "Publishing…" : "Publish my tournament (free) →"}
          </button>
          <p className="text-xs opacity-60 text-center">By listing you agree to accurate details. We may reach out to verify. Bad-faith listings will be removed.</p>
        </form>
      </main>
    </>
  );
}
