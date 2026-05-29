import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function LoginPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"signin" | "register">(params.get("tab") === "register" ? "register" : "signin");
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [email, setE] = useState("");
  const [keep, setKeep] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const r = tab === "signin"
        ? await api.signin(username.trim(), password, keep)
        : await api.register(username.trim(), password, email.trim());
      if (r.ok) { await qc.invalidateQueries(); nav(params.get("back") || "/"); }
      else setErr(r.error || "Something went wrong.");
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  };

  const Tab = ({ id, label }: { id: "signin" | "register"; label: string }) => (
    <button onClick={() => { setTab(id); setErr(""); }}
      className={`flex-1 border-b-2 pb-2 text-sm font-semibold transition ${
        tab === id ? "border-gold-500 text-white" : "border-transparent text-ink-400 hover:text-white"
      }`}>{label}</button>
  );

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6 shadow-glow">
        <div className="mb-5 flex gap-4"><Tab id="signin" label="Sign in" /><Tab id="register" label="Create account" /></div>
        <div className="space-y-3">
          <input value={username} onChange={(e) => setU(e.target.value)} placeholder={tab === "signin" ? "Username or email" : "Username"}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} placeholder="Password"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
          {tab === "register" && (
            <input value={email} onChange={(e) => setE(e.target.value)} placeholder="Email (optional)"
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
          )}
          {tab === "signin" && (
            <label className="flex items-center gap-2 text-sm text-ink-400">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="accent-brand-500" />
              Keep me logged in
            </label>
          )}
          {err && <div className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-400">{err}</div>}
          <button onClick={submit} disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {busy ? "…" : tab === "signin" ? "Sign in" : "Create account"}
          </button>
        </div>
      </div>
    </div>
  );
}
