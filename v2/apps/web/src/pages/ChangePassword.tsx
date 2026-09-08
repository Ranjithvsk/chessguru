// Self-service password change for a signed-in user (students on tenant
// domains rarely have an email, so the emailed reset link is not for them).
// The coach's "Set / reset password" on the Students page remains the way back
// in when a student has forgotten theirs.
import { useEffect, useState } from "react";
import { Link, Navigate, useOutletContext } from "react-router-dom";
import { api } from "../lib/api";

function strength(pw: string): { label: string; pct: number; tone: string } {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: "Too short", pct: 20, tone: "bg-rose-400" };
  if (score === 2) return { label: "Okay", pct: 45, tone: "bg-amber-400" };
  if (score === 3) return { label: "Good", pct: 70, tone: "bg-emerald-400" };
  return { label: "Strong", pct: 100, tone: "bg-emerald-400" };
}

export default function ChangePasswordPage() {
  const ctx = useOutletContext<{ userId: string | null }>();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => { setErr(null); }, [current, next, repeat]);

  if (!ctx?.userId) return <Navigate to="/login?back=/settings/password" replace />;

  const st = strength(next);
  const mismatch = repeat.length > 0 && repeat !== next;
  const canSubmit = next.length >= 6 && repeat === next && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.changePassword(current, next);
      if (r.ok) { setDone(true); setCurrent(""); setNext(""); setRepeat(""); }
      else setErr(r.error || "Could not change the password.");
    } catch (e: any) {
      setErr(e?.message || "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500";

  return (
    <div className="mx-auto max-w-md space-y-4" data-testid="change-password">
      <div>
        <h1 className="font-display text-3xl text-white">Change password</h1>
        <p className="mt-1 text-sm text-ink-400">Signed in as <span className="text-ink-200">{ctx.userId}</span>. Pick something you will remember — at least 6 characters.</p>
      </div>

      {done ? (
        <div className="rounded-xl2 border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-ink-900 to-ink-900 p-6 text-center" data-testid="password-done">
          <div className="text-4xl">✅</div>
          <div className="mt-2 font-display text-xl text-white">Password changed</div>
          <p className="mt-1 text-sm text-ink-300">Use the new one next time you sign in. You stay signed in on this device.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link to="/dashboard" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Back to my dashboard</Link>
            <button onClick={() => setDone(false)} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:bg-ink-800">Change again</button>
          </div>
        </div>
      ) : (
        <form className="space-y-3 rounded-xl2 border border-ink-700 bg-ink-900 p-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">Current password</span>
            <input type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className={field} data-testid="pw-current" />
            <span className="mt-1 block text-[11px] text-ink-500">Leave empty if you have only ever signed in with an email code.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">New password</span>
            <input type={show ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className={field} data-testid="pw-new" />
            {next.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"><div className={`h-full rounded-full transition-all ${st.tone}`} style={{ width: `${st.pct}%` }} /></div>
                <span className="text-[11px] text-ink-400">{st.label}</span>
              </div>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-300">Repeat new password</span>
            <input type={show ? "text" : "password"} value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" className={`${field} ${mismatch ? "border-rose-500" : ""}`} data-testid="pw-repeat" />
            {mismatch && <span className="mt-1 block text-[11px] text-rose-300">The two passwords do not match.</span>}
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-400">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-brand-500" />
            Show passwords
          </label>
          {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" data-testid="pw-error">{err}</div>}
          <button type="submit" disabled={!canSubmit} className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50" data-testid="pw-submit">
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      )}

      <div className="rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-3 text-xs text-ink-400">
        Forgot the current one? If you are a student of an academy, your coach can set a new password for you from the Students page. Otherwise use <Link to="/login" className="text-brand-300 hover:underline">Forgot password</Link> on the sign-in screen (needs the email on your account).
      </div>
    </div>
  );
}
