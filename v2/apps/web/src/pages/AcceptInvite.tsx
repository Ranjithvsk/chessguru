// Public page — coach clicks the link in their invite email and lands here.
// URL: /accept-invite?token=<opaque>
// Flow: fetch the invite (public GET), show academy + inviter, form to pick
// username + password, POST to /auth/accept-invite → session set → land on /academy.
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

const BASE = import.meta.env.VITE_API_BASE ?? "";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json() as Promise<T>;
}

interface PeekResp {
  ok: boolean; error?: string;
  invite?: { email: string; displayName?: string; role: string; academyId: string; academyName: string; invitedByName?: string; expiresAt: string };
}

const ERR_LABEL: Record<string, string> = {
  invalid_token:  "This invite link is malformed.",
  not_found:      "This invite doesn't exist — the link may be broken.",
  already_used:   "This invite has already been used. Sign in with the account you created.",
  expired:        "This invite has expired. Ask the academy owner to send you a new one.",
};

export default function AcceptInvitePage() {
  const [sp] = useSearchParams();
  const token = sp.get("token") || "";
  const nav = useNavigate();
  const [peek, setPeek] = useState<PeekResp | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setPeek({ ok: false, error: "invalid_token" }); return; }
    get<PeekResp>(`/auth/invite/${encodeURIComponent(token)}`).then(setPeek).catch(() => setPeek({ ok: false, error: "invalid_token" }));
  }, [token]);

  useEffect(() => {
    // Pre-fill username hint from the display name if available
    if (peek?.ok && peek.invite?.displayName && !username) {
      setUsername(peek.invite.displayName.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20));
    }
  }, [peek, username]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await post<{ ok: boolean; error?: string; academyId?: string; role?: string }>("/auth/accept-invite", { token, username, password });
      if (!r.ok) { setErr(r.error || "Signup failed."); return; }
      // Hard nav so /academy sees the fresh auth-me
      window.location.href = "/academy";
    } finally { setBusy(false); }
  }

  if (!peek) return <div className="py-16 text-center text-ink-400">Loading invite…</div>;

  if (!peek.ok) {
    const msg = ERR_LABEL[peek.error || ""] || "This invite couldn't be used.";
    return (
      <div className="mx-auto max-w-md rounded-xl2 border border-rose-500/40 bg-rose-500/10 p-6 text-center text-rose-100">
        <div className="mb-2 text-3xl">⚠️</div>
        <h1 className="mb-2 font-display text-xl text-white">Invite not usable</h1>
        <p className="mb-4 text-sm">{msg}</p>
        <Link to="/login" className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Go to sign in</Link>
      </div>
    );
  }

  const inv = peek.invite!;

  return (
    <div className="mx-auto max-w-lg py-8">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6 shadow-xl">
        <div className="mb-1 text-2xl">🎉</div>
        <h1 className="font-display text-2xl text-white">Welcome to <span className="text-brand-300">{inv.academyName}</span></h1>
        <p className="mt-1 text-sm text-ink-400">
          <b className="text-white">{inv.invitedByName || "The academy owner"}</b> invited{" "}
          <b className="text-white">{inv.email}</b> to join as a{" "}
          <span className="rounded-full bg-brand-500/20 px-2 py-0.5 text-xs font-semibold text-brand-100">{inv.role}</span>.
          Pick a username + password below to create your account.
        </p>

        {err && <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Pick a username</label>
            <input required autoFocus value={username}
              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
              minLength={2} maxLength={30}
              placeholder="e.g. coach_priya"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Set a password</label>
            <input required type="password" minLength={6}
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
          </div>
          <button disabled={busy} type="submit"
            className="w-full rounded-lg bg-brand-600 py-2.5 font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
            {busy ? "Creating…" : `Accept & join ${inv.academyName} →`}
          </button>
        </form>

        <div className="mt-6 border-t border-ink-800 pt-4 text-center text-xs text-ink-500">
          Already have an account? <Link to="/login" className="text-brand-400 hover:underline">Sign in instead</Link>
          <br/>Invite expires {new Date(inv.expiresAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}.
        </div>
      </div>
    </div>
  );
}
