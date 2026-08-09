// Password-reset landing. User arrives via emailed link:
//   /reset-password?token=<opaque>
// They pick a new password; on success we auto-sign them in (they can hit
// / to go home) — but actually the backend doesn't auto-sign, we just
// redirect to /login with a success note.

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ username?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async () => {
    setErr("");
    if (!token) return setErr("Missing token — request a fresh reset link.");
    if (pw.length < 6) return setErr("Password too short (min 6 chars).");
    if (pw !== pw2) return setErr("Passwords don't match.");
    setBusy(true);
    try {
      const r = await api.resetPassword(token, pw);
      if (r.ok) setDone({ username: r.username });
      else setErr(r.error || "Reset failed.");
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6 shadow-glow">
        <h1 className="mb-4 font-display text-xl text-white">Reset your password</h1>
        {done ? (
          <>
            <p className="mb-3 text-sm text-emerald-400">
              Password updated{done.username ? ` for ${done.username}` : ""}. You can sign in now.
            </p>
            <button onClick={() => nav("/login")}
              className="w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500">
              Go to sign in
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (6+ chars)"
              autoComplete="new-password" autoFocus
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Repeat new password"
              autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
            {err && <div className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-400">{err}</div>}
            <button onClick={submit} disabled={busy}
              className="w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {busy ? "…" : "Set new password"}
            </button>
            <p className="text-center text-xs text-ink-500">
              <Link to="/login" className="hover:underline">← back to sign in</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
