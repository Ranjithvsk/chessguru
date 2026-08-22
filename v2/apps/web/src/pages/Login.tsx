// ChessGuru sign-in / register / OTP / forgot-password — one page, four modes.

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type Mode = "signin" | "register" | "otp" | "forgot";

export default function LoginPage() {
  const [params] = useSearchParams();
  const initial: Mode = (params.get("tab") as Mode) === "register" ? "register" : "signin";
  const [mode, setMode] = useState<Mode>(initial);
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [email, setE] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [keep, setKeep] = useState(true);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const clearMsg = () => { setErr(""); setNote(""); };

  const submit = async () => {
    clearMsg(); setBusy(true);
    try {
      if (mode === "signin") {
        const r = await api.signin(username.trim(), password, keep);
        if (r.ok) { await qc.invalidateQueries(); nav(params.get("back") || "/"); }
        else setErr(r.error || "Something went wrong.");
      } else if (mode === "register") {
        const r = await api.register(username.trim(), password, email.trim());
        if (r.ok) { await qc.invalidateQueries(); nav(params.get("back") || "/"); }
        else setErr(r.error || "Something went wrong.");
      } else if (mode === "forgot") {
        const r = await api.requestReset(email.trim());
        if (r.ok) setNote("If that email is on file, a reset link is on the way. Check your inbox (and spam).");
        else setErr(r.error || "Something went wrong.");
      } else if (mode === "otp") {
        if (!otpSent) {
          const r = await api.requestOtp(email.trim());
          if (r.ok) { setOtpSent(true); setNote("Check your email for a 6-digit code."); }
          else setErr(r.error || "Something went wrong.");
        } else {
          const r = await api.otpSignin(email.trim(), otp.trim());
          if (r.ok) { await qc.invalidateQueries(); nav(params.get("back") || "/"); }
          else setErr(r.error || "That code is invalid or has expired.");
        }
      }
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  };

  const Tab = ({ id, label }: { id: Mode; label: string }) => (
    <button onClick={() => { setMode(id); clearMsg(); setOtpSent(false); setOtp(""); }}
      className={`flex-1 border-b-2 pb-2 text-sm font-semibold transition ${
        mode === id ? "border-gold-500 text-white" : "border-transparent text-ink-400 hover:text-white"
      }`}>{label}</button>
  );

  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6 shadow-glow">
        <div className="mb-5 flex gap-4">
          <Tab id="signin" label="Sign in" />
          <Tab id="register" label="Create account" />
          <Tab id="otp" label="Email code" />
        </div>

        <div className="space-y-3">
          {/* Sign-in with password */}
          {mode === "signin" && (
            <>
              <input value={username} onChange={(e) => setU(e.target.value)} placeholder="Username or email"
                autoComplete="username"
                className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
              <input type="password" value={password} onChange={(e) => setP(e.target.value)} placeholder="Password"
                autoComplete="current-password"
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
              <label className="flex items-center gap-2 text-sm text-ink-400">
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="accent-brand-500" />
                Keep me logged in
              </label>
              <div className="text-right">
                <button type="button" onClick={() => { setMode("forgot"); clearMsg(); }}
                  className="text-xs font-semibold text-brand-300 hover:text-brand-200 hover:underline">
                  Forgot password?
                </button>
              </div>
            </>
          )}

          {/* Register */}
          {mode === "register" && (
            <>
              <input value={username} onChange={(e) => setU(e.target.value)} placeholder="Username"
                autoComplete="username"
                className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
              <input type="password" value={password} onChange={(e) => setP(e.target.value)} placeholder="Password (6+ chars)"
                autoComplete="new-password"
                className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
              <input type="email" value={email} onChange={(e) => setE(e.target.value)} placeholder="Email (needed for reset + OTP)"
                autoComplete="email"
                className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
            </>
          )}

          {/* Forgot password (request reset link) */}
          {mode === "forgot" && (
            <>
              <p className="text-sm text-ink-400">Enter your account email and we'll send a link to reset your password.</p>
              <input type="email" value={email} onChange={(e) => setE(e.target.value)} placeholder="Email"
                autoComplete="email"
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500" />
              <button type="button" onClick={() => { setMode("signin"); clearMsg(); }}
                className="text-xs font-semibold text-brand-300 hover:underline">← Back to sign in</button>
            </>
          )}

          {/* OTP sign-in */}
          {mode === "otp" && (
            <>
              <p className="text-sm text-ink-400">
                {otpSent ? "Enter the 6-digit code we just emailed you." : "Sign in without a password — we'll email you a 6-digit code."}
              </p>
              <input type="email" value={email} onChange={(e) => setE(e.target.value)} placeholder="Email"
                autoComplete="email" disabled={otpSent}
                className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-white outline-none focus:border-brand-500 disabled:opacity-60" />
              {otpSent && (
                <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code" inputMode="numeric" autoComplete="one-time-code" autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  className="w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2.5 text-center font-mono text-2xl tracking-[0.4em] text-white outline-none focus:border-brand-500" />
              )}
              {otpSent && (
                <button type="button" onClick={() => { setOtpSent(false); setOtp(""); clearMsg(); }}
                  className="text-xs font-semibold text-brand-300 hover:underline">← use a different email</button>
              )}
            </>
          )}

          {err && <div className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-400">{err}</div>}
          {note && <div className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-400">{note}</div>}
          <button onClick={submit} disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-3 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {busy ? "…" :
              mode === "signin"   ? "Sign in" :
              mode === "register" ? "Create account" :
              mode === "forgot"   ? "Send reset link" :
              mode === "otp" && !otpSent ? "Send code" : "Verify code"}
          </button>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-ink-500">
        Signing in? <Link to="/" className="hover:underline">Back home</Link>
      </p>
      {/* Hide the "Create your Academy" prompt on tenant custom domains — those
          visitors are already at a specific academy, we don't want to funnel
          them into signing up their own competing academy. */}
      {(() => {
        const isTenantDomain = typeof window !== "undefined" &&
          !/^(chessguru\.com|chessguru\.cc|harinitharanjith\.com|localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/.test(window.location.hostname.toLowerCase());
        if (isTenantDomain) return null;
        return (
          <div className="mt-4 rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-4 text-center text-sm">
            <div className="mb-1">🏛️ Running a chess academy?</div>
            <Link to="/signup-academy" className="font-semibold text-brand-300 hover:underline">
              Create your Academy →
            </Link>
            <p className="mt-1 text-[11px] text-ink-500">
              Invite coaches, enroll students, run classes. Free during trial.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
