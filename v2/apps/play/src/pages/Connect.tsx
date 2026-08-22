// ChessGuru Connect — WhatsApp control panel for academy owners.
// Tabs: Inbox · Send · Contacts. All calls scoped to the signed-in user's
// academy_id (enforced server-side via session).
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Aurora from "../components/Aurora";
import Nav from "../components/Nav";
import Footer from "../components/Footer";
import { Input } from "../components/FormControls";
import { useMe } from "../lib/useMe";
import {
  connectConfig, connectStats, connectInbox, connectConversation,
  connectSend, connectContacts, connectContactsAdd,
} from "../lib/api";
import { ago } from "../lib/helpers";

type Tab = "inbox" | "send" | "contacts";

export default function Connect() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("inbox");
  const [cfg, setCfg] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([connectConfig(), connectStats()]);
      if (c.error) { setErr(c.error === "AuthRequired" ? "Please sign in as an academy owner or coach." : c.error === "NoAcademy" ? "Your account isn't linked to any academy." : c.error); return; }
      setCfg(c); setStats(s);
    } catch { setErr("Please sign in as an academy owner or coach."); }
  }, []);
  useEffect(() => { if (me?.loggedIn) load(); }, [me?.loggedIn, load]);

  if (!me) return <><Aurora /><Nav /><main className="min-h-[70vh] flex items-center justify-center opacity-60">Loading…</main><Footer /></>;
  if (!me.loggedIn) return (
    <>
      <Aurora /><Nav />
      <main className="min-h-[70vh] flex items-center justify-center text-center p-6">
        <div>
          <div className="text-6xl mb-4">💬</div>
          <h1 className="text-2xl md:text-3xl font-black mt-4">ChessGuru Connect</h1>
          <p className="opacity-80 mt-2 max-w-md mx-auto">WhatsApp for your academy — send updates, remind fees, share tournaments. Sign in as an academy owner to open your inbox.</p>
          <a href={`https://chessguru.cc/login?next=${encodeURIComponent(window.location.href)}`}
             className="inline-block mt-5 rounded-full px-5 py-2.5 text-black font-bold text-sm"
             style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>Sign in →</a>
        </div>
      </main>
      <Footer />
    </>
  );
  if (err) return (
    <>
      <Aurora /><Nav />
      <main className="min-h-[70vh] flex items-center justify-center text-center p-6">
        <div>
          <h1 className="text-2xl font-black">🔒 {err}</h1>
          <p className="mt-2 opacity-70 max-w-md">ChessGuru Connect is available to academy owners + coaches. If you think this is a mistake, ping hello@chessguru.cc.</p>
          <a href="https://chessguru.cc/signup-academy" className="inline-block mt-4 rounded-full px-5 py-2.5 text-black font-bold" style={{ background: "linear-gradient(135deg,#fbbf24,#f59e0b)" }}>Start free trial</a>
        </div>
      </main>
      <Footer />
    </>
  );
  if (!cfg) return <><Aurora /><Nav /><main className="min-h-[70vh] flex items-center justify-center opacity-60">Loading Connect…</main><Footer /></>;

  return (
    <>
      <Aurora /><Nav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between mb-6 gap-4">
          <div>
            <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#25D366" }}>💬 WhatsApp · Beta</div>
            <h1 className="text-3xl md:text-4xl font-black mt-1">ChessGuru Connect</h1>
            <p className="opacity-70 mt-2 text-sm">Send WhatsApp updates to your students' parents. Replies land in your inbox — routing is automatic.</p>
          </div>
          {stats && (
            <div className="flex gap-3 text-center">
              <Stat n={stats.contacts} l="contacts" c="#fbbf24" />
              <Stat n={stats.unread} l="unread" c="#f472b6" />
              <Stat n={stats.inbound_24h} l="in · 24h" c="#25D366" />
              <Stat n={stats.outbound_24h} l="out · 24h" c="#60a5fa" />
            </div>
          )}
        </div>

        {!cfg.configured && (
          <div className="mb-4 text-sm px-4 py-3 rounded-xl border border-amber-400/40 bg-amber-500/10 text-amber-200">
            ⚠️ WhatsApp phone number not yet configured on the platform. Contact hello@chessguru.cc.
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {(["inbox","send","contacts"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
                    className={`text-sm font-semibold rounded-full px-4 py-2 border transition ${tab === t ? "text-black border-transparent" : "text-[color:var(--text-dim)] border-[color:var(--border-strong)] hover:bg-[color:var(--hover)]"}`}
                    style={tab === t ? { background: "linear-gradient(135deg,#25D366,#128C7E)" } : {}}>
              {t === "inbox" && `📥 Inbox${stats?.unread ? ` (${stats.unread})` : ""}`}
              {t === "send" && "✉️ Send"}
              {t === "contacts" && "👥 Contacts"}
            </button>
          ))}
        </div>

        {tab === "inbox" && <InboxTab onSent={load} />}
        {tab === "send" && <SendTab cfg={cfg} onSent={load} />}
        {tab === "contacts" && <ContactsTab onChange={load} />}
      </main>
      <Footer />
    </>
  );
}

function Stat({ n, l, c }: { n: number | string; l: string; c: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] px-3 py-2 min-w-[70px]" style={{ background: "var(--card-bg)" }}>
      <div className="text-xl font-black leading-tight" style={{ color: c }}>{n}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{l}</div>
    </div>
  );
}

// ── Inbox tab: list of conversations + chat view ────────────────────────
function InboxTab({ onSent }: { onSent: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<any[] | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(() => connectInbox().then((r) => setRows(r.rows || [])).catch(() => setRows([])), []);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    if (!active) { setMsgs(null); return; }
    connectConversation(active).then((r) => setMsgs(r.messages || [])).catch(() => setMsgs([]));
  }, [active]);

  async function sendReply() {
    if (!active || !reply.trim()) return;
    setBusy(true);
    const r = await connectSend({ to: active, text: reply });
    setBusy(false);
    if (r.ok) {
      setReply("");
      connectConversation(active).then((r) => setMsgs(r.messages || []));
      onSent();
    } else alert(r.error || "Send failed");
  }

  if (!rows) return <Loading />;
  if (rows.length === 0) return (
    <div className="text-center py-16 rounded-2xl border border-[color:var(--border)]" style={{ background: "var(--card-bg-lg)" }}>
      <div className="text-4xl mb-2">📭</div>
      <div className="font-semibold">No inbound messages yet.</div>
      <div className="text-xs opacity-70 mt-1">Once a parent replies to any of your sends, it lands here.</div>
    </div>
  );

  return (
    <div className="grid md:grid-cols-[300px_1fr] gap-4">
      <div className="rounded-2xl border border-[color:var(--border)] overflow-y-auto max-h-[70vh]" style={{ background: "var(--card-bg-lg)" }}>
        {rows.map((r) => (
          <button key={r._id} onClick={() => setActive(r._id)}
                  className={`w-full text-left p-3 border-b border-white/5 hover:bg-[color:var(--hover)] ${active === r._id ? "bg-[color:var(--hover)]" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold text-sm truncate">{r.name || `+${r._id}`}</div>
              <div className="text-[10px] opacity-60 flex-none">{ago(r.last_at)}</div>
            </div>
            <div className="text-xs opacity-70 truncate mt-0.5">{r.last_body}</div>
            {r.unread_count > 0 && (
              <div className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/30 text-rose-200">{r.unread_count} unread</div>
            )}
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-[color:var(--border)] flex flex-col max-h-[70vh]" style={{ background: "var(--card-bg-lg)" }}>
        {!active ? (
          <div className="flex-1 flex items-center justify-center opacity-60 text-sm">Pick a conversation from the left</div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!msgs ? <Loading /> : msgs.map((m: any, i: number) => (
                <div key={i} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.direction === "out" ? "bg-emerald-500/20 rounded-br-sm" : "bg-[color:var(--hover)] rounded-bl-sm"}`}>
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className="text-[10px] opacity-60 mt-1">{new Date(m.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{m.status && ` · ${m.status}`}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-[color:var(--border)] p-3 flex gap-2">
              <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
                     placeholder="Reply (free-form within 24h of their last msg)"
                     className="flex-1 rounded-full border border-[color:var(--border-strong)] bg-[color:var(--input-bg)] px-4 py-2 text-sm text-white placeholder:text-[color:var(--text-muted)] focus:border-emerald-400 focus:outline-none" />
              <button disabled={busy || !reply.trim()} onClick={sendReply}
                      className="rounded-full px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                      style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>{busy ? "…" : "Send"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Send tab: template-based bulk / one-off ─────────────────────────────
function SendTab({ cfg, onSent }: { cfg: any; onSent: () => void }) {
  const [mode, setMode] = useState<"one" | "bulk">("one");
  const [to, setTo] = useState(""); const [name, setName] = useState("");
  const [tournament, setTournament] = useState("your upcoming tournament");
  const [bulk, setBulk] = useState("");    // one phone per line
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setResult(null);
    const targets = mode === "one" ? [to] : bulk.split(/\n/).map(s => s.trim()).filter(Boolean);
    if (!targets.length) { setBusy(false); setResult("❌ No recipients"); return; }
    if (!cfg.default_template) { setBusy(false); setResult("❌ No approved template configured. Ask hello@chessguru.cc to enable one."); return; }
    let sent = 0, failed = 0;
    for (const t of targets) {
      const r = await connectSend({ to: t, template: cfg.default_template, vars: [name || "there", tournament || "your upcoming tournament"] });
      if (r.ok) sent++; else failed++;
      await new Promise(res => setTimeout(res, 300));    // ~3/sec throttle
    }
    setBusy(false); setResult(`✅ ${sent} sent · ❌ ${failed} failed`);
    onSent();
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-[color:var(--border)] p-6 space-y-4" style={{ background: "var(--card-bg-lg)" }}>
      <div className="flex gap-2 mb-4">
        {(["one","bulk"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
                  className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${mode === m ? "text-black border-transparent" : "text-[color:var(--text-dim)] border-[color:var(--border-strong)]"}`}
                  style={mode === m ? { background: "linear-gradient(135deg,#25D366,#128C7E)" } : {}}>{m === "one" ? "Single" : "Bulk"}</button>
        ))}
      </div>

      {mode === "one" ? (
        <Input label="Recipient phone" required value={to} onChange={(e: any) => setTo(e.target.value)} placeholder="9876543210 or +91 98765 43210" />
      ) : (
        <div>
          <div className="text-xs font-semibold opacity-80 mb-1.5">Phone numbers (one per line)</div>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5}
                    placeholder={"9876543210\n9876543211\n9876543212"}
                    className="w-full rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--input-bg)] px-4 py-2.5 text-sm text-white placeholder:text-[color:var(--text-muted)] focus:border-emerald-400 focus:outline-none font-mono" />
          <div className="text-[11px] opacity-60 mt-1">Throttled to ~3 per second on send.</div>
        </div>
      )}

      <div className="border-t border-[color:var(--border)] pt-4">
        <div className="text-xs font-semibold tracking-widest uppercase opacity-70 mb-2" style={{ color: "#25D366" }}>Template variables</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Recipient name ({{1}})" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Parent" />
          <Input label="Tournament / subject ({{2}})" value={tournament} onChange={(e: any) => setTournament(e.target.value)} placeholder="Weekend rapid at XYZ" />
        </div>
        {cfg.default_template && (
          <div className="text-[11px] opacity-60 mt-2">Using template: <span className="font-mono">{cfg.default_template}</span></div>
        )}
      </div>

      {result && <div className={`text-sm px-4 py-2.5 rounded-xl border ${result.startsWith("❌") ? "border-rose-400/40 bg-rose-500/10 text-rose-300" : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"}`}>{result}</div>}
      <button type="submit" disabled={busy}
              className="w-full rounded-full py-3 font-bold text-white text-sm disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>
        {busy ? "Sending…" : mode === "one" ? "Send message" : "Send to all"}
      </button>
    </form>
  );
}

// ── Contacts tab: list + import ─────────────────────────────────────────
function ContactsTab({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(() => connectContacts().then((r) => setRows(r.rows || [])).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  async function importCsv(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setResult(null);
    const bulk = importText.split(/\n/).map(l => l.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[,\t]/).map(s => s.trim());
      return { phone: parts[0], name: parts[1] || null };
    });
    if (!bulk.length) { setBusy(false); return; }
    const r = await connectContactsAdd({ bulk });
    setBusy(false);
    setResult(r.ok ? `✅ ${r.added} added · ${r.updated} updated` : `❌ ${r.error || "Import failed"}`);
    setImportText(""); load(); onChange();
  }

  return (
    <div className="grid md:grid-cols-[1fr_320px] gap-4">
      <div className="rounded-2xl border border-[color:var(--border)] overflow-hidden" style={{ background: "var(--card-bg-lg)" }}>
        <div className="text-xs font-semibold opacity-70 uppercase tracking-wider px-4 py-3 border-b border-[color:var(--border)]">
          Your contacts ({rows?.length ?? "…"})
        </div>
        {!rows ? <Loading /> : rows.length === 0 ? (
          <div className="text-center py-10 opacity-70 text-sm">No contacts yet. Import a CSV or paste phones on the right.</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {rows.map((r) => (
              <div key={r._id} className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between hover:bg-[color:var(--hover)]">
                <div>
                  <div className="font-semibold text-sm">{r.name || <span className="opacity-60">Unnamed</span>}</div>
                  <div className="text-xs opacity-70 font-mono">+{r.phone}</div>
                </div>
                <div className="text-[10px] opacity-60">{ago(r.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={importCsv} className="rounded-2xl border border-[color:var(--border)] p-4" style={{ background: "var(--card-bg-lg)" }}>
        <div className="text-xs font-semibold opacity-70 uppercase tracking-wider mb-3">Import contacts</div>
        <div className="text-[11px] opacity-70 mb-2">Paste one contact per line. Format: <span className="font-mono">phone,name</span> (comma or tab).</div>
        <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8}
                  placeholder={"9876543210,Aarav Parent\n9876543211,Priya\n9876543212"}
                  className="w-full rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--input-bg)] px-3 py-2 text-xs text-white placeholder:text-[color:var(--text-muted)] focus:border-emerald-400 focus:outline-none font-mono" />
        {result && <div className={`mt-2 text-xs px-2 py-1.5 rounded ${result.startsWith("❌") ? "text-rose-300" : "text-emerald-300"}`}>{result}</div>}
        <button type="submit" disabled={busy || !importText.trim()}
                className="mt-3 w-full rounded-full py-2 text-xs font-bold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#25D366,#128C7E)" }}>{busy ? "Importing…" : "Import"}</button>
      </form>
    </div>
  );
}

function Loading() { return <div className="text-center py-8 opacity-60 text-sm">Loading…</div>; }
