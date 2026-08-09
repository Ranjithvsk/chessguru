// Q1 SaaS foundation: form for a coach/owner to create a brand-new academy.
// Success → session is set to (owner, academyId, role='academy_owner') and we
// land on /academy. Owner then invites coaches from there.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

type FieldErr = string | null;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export default function SignupAcademyPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [academyName, setAcademyName] = useState("");
  const [ownerName,   setOwnerName]   = useState("");
  const [ownerEmail,  setOwnerEmail]  = useState("");
  const [password,    setPassword]    = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<FieldErr>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await post<{ ok: boolean; error?: string; academyName?: string }>("/auth/signup-academy",
        { academyName, ownerName, ownerEmail, password });
      if (!r.ok) { setErr(r.error || "Signup failed."); return; }
      // Hard nav so App shell + auth-me caches are all rehydrated from scratch —
      // avoids a race where the /academy render sees stale {loggedIn:false} and
      // bounces us to /login.
      qc.removeQueries();
      window.location.href = "/academy";
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-lg py-8">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6 shadow-xl">
        <div className="mb-1 text-2xl">🏛️</div>
        <h1 className="mb-1 font-display text-2xl text-white">Create your Academy</h1>
        <p className="mb-6 text-sm text-ink-400">
          Sign up as the academy owner — you can invite coaches and enroll students right after.
          Free during the trial period.
        </p>

        {err && (
          <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Academy name</label>
            <input required autoFocus value={academyName} onChange={(e) => setAcademyName(e.target.value)}
              placeholder="Stephens Chess Academy"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Your username (owner login)</label>
            <input required value={ownerName} onChange={(e) => setOwnerName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              minLength={2} maxLength={30} title="2-30 chars, letters/numbers/_/-"
              placeholder="john_stephens"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Your email</label>
            <input required type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="you@yourschool.com"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
            <p className="mt-1 text-[11px] text-ink-500">Used for password reset + parent notifications.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Password</label>
            <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>

          <button disabled={busy} type="submit"
            className="w-full rounded-lg bg-brand-600 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {busy ? "Creating…" : "Create academy →"}
          </button>
        </form>

        <div className="mt-6 border-t border-ink-800 pt-4 text-center text-sm text-ink-400">
          Already have an account? <Link to="/login" className="text-brand-400 hover:underline">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
