// TrialSignupForm — the self-serve academy signup card. Lives in the hero of
// /signup-academy (owner 2026-09-10: "start your free trial signup in top
// itself"); every other marketing page links to /signup-academy#signup.
// Posts to /auth/signup-academy (Nest auth is NOT under /api — see
// feedback_chessguru_auth_path) and lands the new owner on /academy.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CTA_STYLE, M } from "./MarketingShell";
import { TRIAL_DAYS } from "./data";

export default function TrialSignupForm() {
  const nav = useNavigate();
  const [f, setF] = useState({ academyName: "", fullName: "", ownerEmail: "", ownerMobile: "", password: "", mobileConsent: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";
      const res = await fetch(`${BASE}/auth/signup-academy`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(f),
      });
      const j = await res.json();
      if (j?.ok) {
        setMsg({ ok: true, text: "Trial started — taking you to your dashboard…" });
        setTimeout(() => nav("/academy"), 800);
      } else {
        setMsg({ ok: false, text: j?.error || "Signup failed — try again in a moment." });
      }
    } catch {
      setMsg({ ok: false, text: "Network hiccup — check your connection and retry." });
    } finally { setBusy(false); }
  }

  return (
    <div id="signup" className="relative rounded-[28px] border p-7 md:p-9 scroll-mt-32" style={{ background: M.card, borderColor: M.line, boxShadow: "0 30px 80px rgba(124,45,18,0.12)" }}>
      <div className="absolute -top-4 -right-3 rounded-full px-4 py-2 text-sm font-black text-white shadow-lg rotate-3" style={{ background: M.orange }}>
        {TRIAL_DAYS} days free
      </div>
      <h2 className="text-2xl md:text-[28px] font-black tracking-tight">Start your free trial</h2>
      <p className="text-sm mt-1 mb-6" style={{ color: M.ink3 }}>{TRIAL_DAYS} days on us. No card. Full access, unlimited students.</p>

      <form onSubmit={submit} className="space-y-4">
        <Input label="Academy name" value={f.academyName} onChange={(v) => setF({ ...f, academyName: v })} placeholder="Stephens Chess Academy" required autoComplete="organization" />
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Your name" value={f.fullName} onChange={(v) => setF({ ...f, fullName: v })} placeholder="Ranjith VS" required autoComplete="name" />
          <Input label="Mobile number" type="tel" required value={f.ownerMobile} onChange={(v) => setF({ ...f, ownerMobile: v })} placeholder="+91 98765 43210" autoComplete="tel" />
        </div>
        <Input label="Email address" type="email" value={f.ownerEmail} onChange={(v) => setF({ ...f, ownerEmail: v })} placeholder="you@academy.com" required autoComplete="email" />
        <Input label="Choose a password" type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} placeholder="At least 6 characters" required autoComplete="new-password" />
        <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: M.ink2 }}>
          <input type="checkbox" checked={f.mobileConsent} onChange={(e) => setF({ ...f, mobileConsent: e.target.checked })} className="mt-0.5 accent-orange-500" />
          <span>Send me WhatsApp updates about my trial (no spam, cancel any time). Your number is never shown to students.</span>
        </label>

        {msg && (
          <div className={`text-sm px-4 py-3 rounded-xl border ${msg.ok ? "border-emerald-400/50 bg-emerald-50 text-emerald-800" : "border-rose-400/50 bg-rose-50 text-rose-800"}`}>
            {msg.text}
          </div>
        )}

        <button type="submit" disabled={busy} className="w-full rounded-full py-3.5 font-bold text-base disabled:opacity-60 hover:brightness-105 transition" style={CTA_STYLE}>
          {busy ? "Starting your trial…" : `Start my ${TRIAL_DAYS}-day free trial →`}
        </button>
        <p className="text-xs text-center pt-1" style={{ color: M.ink3 }}>
          Already have an account? <a href="/login" className="underline underline-offset-2 font-semibold" style={{ color: M.ink2 }}>Sign in</a>
        </p>
      </form>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", required = false, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean; autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold mb-1.5 block" style={{ color: M.ink2 }}>{label}{required && <span style={{ color: M.orange }}> *</span>}</span>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} autoComplete={autoComplete}
        className="w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-300 transition"
        style={{ borderColor: "rgba(28,25,23,0.15)", background: "#fffaf5", color: M.ink }}
      />
    </label>
  );
}
