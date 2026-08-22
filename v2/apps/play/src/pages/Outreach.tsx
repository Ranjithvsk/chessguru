// /admin/outreach — dispatch the WhatsApp intro messages to every organizer we
// scraped a phone number for. Each row has a pre-filled wa.me deep-link (opens
// WhatsApp with the message already typed — owner just taps Send). Marking a
// row "Sent" persists so we don't nag anyone twice + adds a green ✓ badge.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminOutreach, adminOutreachMark, adminOutreachSend, adminOutreachBatchSend } from "../lib/api";
import { rupees, ago } from "../lib/helpers";

interface Row {
  phone: string; waPhone: string; wa_url: string;
  organizer: string; city?: string; state?: string;
  first_tournament: string; first_start?: string;
  tournament_count: number; max_prize_paise?: number | null;
  sent_at?: string | null; responded_at?: string | null; note?: string | null;
}

export default function Outreach() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "SENT" | "RESPONDED">("ALL");
  const [batchBusy, setBatchBusy] = useState(false);
  const [autoResult, setAutoResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null); setErr(null);
    try {
      const r: any = await adminOutreach();
      if (r?.error) { setErr(r.error === "Forbidden" ? "You must be signed in as a super-admin to see this page." : r.error); return; }
      setRows(r.rows || []);
    } catch { setErr("You must be signed in as a super-admin to see this page."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(phone: string, body: any) {
    setBusyPhone(phone);
    await adminOutreachMark(phone, body).catch(() => null);
    setBusyPhone(null);
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

  const total = rows?.length ?? 0;
  const sent = rows?.filter((r) => r.sent_at).length ?? 0;
  const responded = rows?.filter((r) => r.responded_at).length ?? 0;

  const filtered = rows?.filter((r) =>
    filter === "ALL" ? true :
    filter === "PENDING" ? !r.sent_at :
    filter === "SENT" ? r.sent_at && !r.responded_at :
    !!r.responded_at
  ) ?? [];

  // Batch-send: open N pending wa.me tabs staggered so WhatsApp Web/app can
  // handle them without dropping. User hits Send in each tab manually — this
  // just eliminates the "click row → click Open" round-trip.
  async function batchSend(n: number) {
    const pending = filtered.filter((r) => !r.sent_at).slice(0, n);
    if (!pending.length) return;
    if (!confirm(`Open ${pending.length} WhatsApp tabs? You'll still need to click Send in each. Space out further batches by ~5 min to avoid WhatsApp's burst detection.`)) return;
    setBatchBusy(true);
    for (let i = 0; i < pending.length; i++) {
      window.open(pending[i]!.wa_url, "_blank", "noopener");
      // Stagger 800ms — enough to let browser register each new tab + WhatsApp Web to spin up.
      await new Promise((r) => setTimeout(r, 800));
    }
    setBatchBusy(false);
  }

  // Server-side Twilio send (bypasses browser entirely; needs approved template + env creds).
  // NOTE: autoResult state lives at the TOP of the component — hooks must NEVER live
  // below the `if (err) return` guard. Two React #300 crashes today from this exact pattern.
  async function twilioOne(phone: string, channel: "whatsapp" | "sms") {
    setBusyPhone(phone);
    const r = await adminOutreachSend(phone, { channel });
    setBusyPhone(null);
    if (r.ok) {
      setAutoResult(`${channel === "whatsapp" ? "🤖 WhatsApp" : "📱 SMS"} sent (${r.provider_id || "queued"}${r.dry_run ? ", DRY RUN" : ""})`);
      load();
    } else {
      setAutoResult(`❌ ${r.error || "Send failed"}`);
    }
  }
  async function twilioBatch(n: number, channel: "whatsapp" | "sms") {
    if (!confirm(`Server-side send ${n} pending organizers via ${channel === "whatsapp" ? "Twilio WhatsApp" : "MSG91 SMS"}?\n\nRequires template approval + env creds set on chessguru-v2-api. If not configured, you'll see a clear error per row.`)) return;
    setBatchBusy(true); setAutoResult("Sending…");
    const r = await adminOutreachBatchSend({ n, channel });
    setBatchBusy(false);
    setAutoResult(`✅ ${r.sent || 0} sent / ${r.failed || 0} failed via ${channel}`);
    load();
  }

  return (
    <>
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-black/40 border-b border-white/10 py-3 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg">
            <span style={{ color: "#fbbf24" }}>♟</span><span>ChessGuru</span>
            <span className="text-xs font-normal opacity-60 border border-white/20 rounded-full px-2 py-0.5 ml-1">Play · Outreach</span>
          </Link>
          <div className="flex gap-3 text-sm">
            <Link to="/admin" className="opacity-80 hover:opacity-100">← Admin</Link>
            <Link to="/" className="opacity-80 hover:opacity-100">Site</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-6">
        <div className="mb-6">
          <div className="text-xs font-semibold tracking-widest uppercase opacity-70" style={{ color: "#25D366" }}>WhatsApp outreach</div>
          <h1 className="text-3xl md:text-4xl font-black mt-1">Organizer dispatcher</h1>
          <p className="opacity-70 mt-2 text-sm max-w-2xl">Each row has a pre-filled WhatsApp message. Tap the 💬 button → WhatsApp opens with the message ready — just hit send. Mark ✓ Sent to hide from the pending list.</p>
        </div>

        {rows && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { l: "Total", v: total, c: "#fbbf24" },
              { l: "Sent", v: sent, c: "#25D366" },
              { l: "Responded", v: responded, c: "#c084fc" },
              { l: "Pending", v: total - sent, c: "#f472b6" },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-white/10 p-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="text-xs uppercase tracking-wider opacity-70">{s.l}</div>
                <div className="text-2xl font-black mt-1" style={{ color: s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          {(["ALL","PENDING","SENT","RESPONDED"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
                    className={`text-xs font-semibold rounded-full px-3 py-1.5 border transition ${filter === f ? "text-black border-transparent" : "text-white/80 border-white/20 hover:bg-white/5"}`}
                    style={filter === f ? { background: "linear-gradient(135deg,#fbbf24,#f472b6)" } : {}}>{f[0] + f.slice(1).toLowerCase()}</button>
          ))}
          <div className="flex-1" />
          {/* Batch-open buttons — cut clicks per organizer from 2 to 1 (hit Send in each tab). */}
          <span className="text-xs opacity-70 mr-1 hidden md:inline">Manual (opens tabs) →</span>
          <button disabled={batchBusy} onClick={() => batchSend(5)}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40">🚀 Next 5</button>
          <button disabled={batchBusy} onClick={() => batchSend(10)}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40">🚀 Next 10</button>
          <span className="text-xs opacity-70 mx-1 ml-3 hidden md:inline">Automated →</span>
          <button disabled={batchBusy} onClick={() => twilioBatch(5, "whatsapp")}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 border border-blue-400/40 text-blue-300 hover:bg-blue-500/10 disabled:opacity-40" title="Send via Twilio WhatsApp API">🤖 WA 5</button>
          <button disabled={batchBusy} onClick={() => twilioBatch(5, "sms")}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 border border-purple-400/40 text-purple-300 hover:bg-purple-500/10 disabled:opacity-40" title="Send via MSG91 SMS">📱 SMS 5</button>
        </div>
        {autoResult && (
          <div className={`mb-3 text-sm px-4 py-2.5 rounded-xl border ${autoResult.startsWith("❌") ? "border-rose-400/40 bg-rose-500/10 text-rose-300" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"}`}>
            {autoResult}
          </div>
        )}
        <div className="text-[11px] opacity-60 mb-4">
          💡 <b>Batch tip:</b> Open <b>WhatsApp Web</b> in a separate tab first (web.whatsapp.com), verify the QR scan.
          Then hit "Next 5" here — five new tabs will open, each with the message pre-filled. Just click <b>Send</b> in each, close the tab, wait ~5 min, do the next 5.
          Sends spaced out over the day = zero ban risk.
        </div>

        {!rows ? <div className="text-center opacity-60 py-10">Loading…</div> : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <div key={r.phone} className="rounded-2xl border border-white/10 p-4"
                   style={{ background: r.sent_at ? "rgba(37,211,102,0.05)" : "rgba(255,255,255,0.02)" }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold">{r.organizer || "—"}</span>
                      <span className="text-xs opacity-60">{r.tournament_count} tournament{r.tournament_count !== 1 ? "s" : ""}</span>
                      {r.max_prize_paise && <span className="text-xs text-amber-300 font-semibold">{rupees(r.max_prize_paise)} prize</span>}
                      {r.sent_at && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">✓ Sent {ago(r.sent_at)}</span>}
                      {r.responded_at && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">💬 Responded {ago(r.responded_at)}</span>}
                    </div>
                    <div className="text-xs opacity-70 truncate">
                      📞 +{r.waPhone} · 📍 {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                    </div>
                    <div className="text-xs opacity-60 mt-1 truncate">First tournament: {r.first_tournament}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={r.wa_url} target="_blank" rel="noopener"
                       className="rounded-full px-3 py-2 text-xs font-bold text-white shadow-lg"
                       style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>💬 Manual</a>
                    <button onClick={() => twilioOne(r.phone, "whatsapp")}
                            className="rounded-full px-3 py-2 text-xs font-bold border border-blue-400/40 text-blue-300 hover:bg-blue-500/10" title="Server-side via Twilio">🤖 Auto</button>
                    {busyPhone === r.phone ? <span className="text-xs opacity-60 px-3 py-2">…</span> : (
                      <>
                        {!r.sent_at
                          ? <button onClick={() => act(r.phone, { action: "sent" })} className="text-xs px-3 py-2 rounded-full border border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/10">Mark sent ✓</button>
                          : <button onClick={() => act(r.phone, { action: "unsent" })} className="text-xs px-3 py-2 rounded-full border border-white/20 opacity-80 hover:opacity-100">↩ Unmark</button>}
                        {r.sent_at && !r.responded_at && (
                          <button onClick={() => act(r.phone, { action: "responded" })} className="text-xs px-3 py-2 rounded-full border border-purple-400/40 text-purple-300 hover:bg-purple-500/10">Mark responded 💬</button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <div className="text-center opacity-60 py-8">No organizers match this filter.</div>}
          </div>
        )}
      </main>
    </>
  );
}
