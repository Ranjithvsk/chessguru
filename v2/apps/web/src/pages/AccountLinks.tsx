// Link Lichess (OAuth) + Chess.com (username + profile-token verify).
// Fetches /api/me/linked-accounts on load; shows status + game count per
// platform; lets the user unlink or refresh imported games.
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

const BASE = import.meta.env.VITE_API_BASE ?? "";

type Ratings = { bullet?: number|null; blitz?: number|null; rapid?: number|null; classical?: number|null; puzzle?: number|null; daily?: number|null };
type LinkedLichess = { username: string; title?: string|null; ratings?: Ratings|null; linkedAt: string; lastImportAt?: string|null; gameCount: number };
type LinkedChesscom = ({ username: string; title?: string|null; country?: string|null; ratings?: Ratings|null; linkedAt: string; lastImportAt?: string|null; gameCount: number })
                    | ({ pending: true; pendingHandle: string; verifyToken: string });
type Status = { lichess: LinkedLichess|null; chesscom: LinkedChesscom|null };

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  return r.json() as Promise<T>;
}

function fmtAgo(d?: string|null) {
  if (!d) return "—";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
}

function Rating({ label, value }: { label: string; value: number|null|undefined }) {
  if (value == null) return null;
  return (
    <span className="rounded-full bg-ink-800 px-2.5 py-0.5 text-[11px] text-ink-200">
      {label} <b className="text-white">{value}</b>
    </span>
  );
}

export default function AccountLinksPage() {
  const [sp, setSp] = useSearchParams();
  const linkedStatus = sp.get("linked"), oauthStatus = sp.get("status"), handle = sp.get("handle");
  const qc = useQueryClient();
  const { data: me, isLoading: authLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["linked-accounts"],
    queryFn: () => get<Status>("/api/me/linked-accounts"),
    enabled: !!me?.loggedIn,
    refetchInterval: 5000,   // catches async import completion
  });

  const [cHandle, setCHandle] = useState("");
  const [cErr, setCErr] = useState<string|null>(null);
  const [initInfo, setInitInfo] = useState<{ verifyToken: string; instructions: string; handle: string }|null>(null);

  const initMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; verifyToken?: string; instructions?: string }>("/api/link/chesscom/init", { handle: cHandle }),
    onSuccess: (r) => {
      if (r.ok && r.verifyToken) { setInitInfo({ verifyToken: r.verifyToken, instructions: r.instructions || "", handle: cHandle }); setCErr(null); }
      else setCErr(r.error || "Init failed");
      qc.invalidateQueries({ queryKey: ["linked-accounts"] });
    },
  });
  const verifyMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; handle?: string }>("/api/link/chesscom/verify", { handle: initInfo?.handle ?? cHandle }),
    onSuccess: (r) => {
      if (!r.ok) setCErr(r.error || "Verification failed");
      else { setInitInfo(null); setCHandle(""); setCErr(null); }
      qc.invalidateQueries({ queryKey: ["linked-accounts"] });
    },
  });
  const unlinkChessMut = useMutation({
    mutationFn: () => post("/api/link/chesscom/unlink"),
    onSuccess: () => { setInitInfo(null); qc.invalidateQueries({ queryKey: ["linked-accounts"] }); },
  });
  const unlinkLichessMut = useMutation({
    mutationFn: () => post("/api/link/lichess/unlink"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["linked-accounts"] }),
  });
  const refreshMut = useMutation({
    mutationFn: () => post<{ ok: boolean; imported?: number; error?: string }>("/api/me/linked-accounts/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["linked-accounts"] }),
  });

  async function linkLichess() {
    const r = await get<{ authUrl: string }>("/api/link/lichess/start");
    window.location.href = r.authUrl;   // Lichess OAuth is same-tab; comes back via /callback → /settings/accounts
  }

  useEffect(() => { if (linkedStatus) refetch(); /* refresh after OAuth callback */ }, [linkedStatus, refetch]);
  // Strip the ?linked=&status=&handle= params off the URL once we've read them
  // (with a small delay so the banner has time to render). Prevents a stale
  // "failed" banner from sticking around after a subsequent successful retry.
  useEffect(() => {
    if (!linkedStatus) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(sp);
      next.delete("linked"); next.delete("status"); next.delete("handle");
      setSp(next, { replace: true });
    }, 6000);
    return () => clearTimeout(t);
  }, [linkedStatus, sp, setSp]);

  if (authLoading) return <div className="py-16 text-center text-ink-400">Loading…</div>;
  if (!me?.loggedIn) return <Navigate to="/login?back=/settings/accounts" replace />;

  const l = data?.lichess ?? null;
  const c = data?.chesscom ?? null;
  const cLinked = c && !("pending" in c) ? c : null;
  const cPending = c && "pending" in c ? c : null;
  // If the account is currently linked, real state beats the URL — don't show
  // a failure banner from an earlier attempt when the retry clearly worked.
  const showLichessError = linkedStatus === "lichess" && oauthStatus && oauthStatus !== "ok" && !l;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="font-display text-2xl text-white">🔗 Linked accounts</h1>
        <p className="text-sm text-ink-400">Link your Lichess + Chess.com accounts to pull in your games and ratings.</p>
      </div>

      {linkedStatus === "lichess" && oauthStatus === "ok" && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          ✅ Lichess linked as <b className="text-white">{handle}</b>. Games are importing in the background.
        </div>
      )}
      {showLichessError && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          Lichess link failed: <code>{oauthStatus}</code>. Try again — this usually clears itself on retry.
        </div>
      )}

      {/* Lichess */}
      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-white">♞ Lichess</div>
            <p className="text-xs text-ink-400">OAuth link — Lichess authorizes you in one click.</p>
          </div>
          {l ? <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">Linked</span>
             : <button onClick={linkLichess} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Link Lichess</button>}
        </header>
        {l && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-500/15 px-3 py-1 text-sm font-semibold text-brand-100">{l.title ? `${l.title} ` : ""}{l.username}</span>
              <a href={`https://lichess.org/@/${l.username}`} target="_blank" rel="noreferrer" className="text-xs text-ink-400 underline hover:text-white">profile ↗</a>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Rating label="Puzzle"    value={l.ratings?.puzzle} />
              <Rating label="Bullet"    value={l.ratings?.bullet} />
              <Rating label="Blitz"     value={l.ratings?.blitz} />
              <Rating label="Rapid"     value={l.ratings?.rapid} />
              <Rating label="Classical" value={l.ratings?.classical} />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-ink-400">
              <span><b className="text-white">{l.gameCount}</b> games imported</span>
              <span>last sync {fmtAgo(l.lastImportAt)}</span>
              <button onClick={() => unlinkLichessMut.mutate()} disabled={unlinkLichessMut.isPending}
                className="ml-auto text-rose-300 underline hover:text-rose-200 disabled:opacity-50">
                Unlink
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Chess.com */}
      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-white">♟ Chess.com</div>
            <p className="text-xs text-ink-400">No OAuth — verify by pasting a short token into your profile Location.</p>
          </div>
          {cLinked && <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">Linked</span>}
        </header>

        {cLinked && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-500/15 px-3 py-1 text-sm font-semibold text-brand-100">{cLinked.title ? `${cLinked.title} ` : ""}{cLinked.username}</span>
              <a href={`https://www.chess.com/member/${cLinked.username}`} target="_blank" rel="noreferrer" className="text-xs text-ink-400 underline hover:text-white">profile ↗</a>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Rating label="Bullet" value={cLinked.ratings?.bullet} />
              <Rating label="Blitz"  value={cLinked.ratings?.blitz} />
              <Rating label="Rapid"  value={cLinked.ratings?.rapid} />
              <Rating label="Daily"  value={cLinked.ratings?.daily} />
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-ink-400">
              <span><b className="text-white">{cLinked.gameCount}</b> games imported</span>
              <span>last sync {fmtAgo(cLinked.lastImportAt)}</span>
              <button onClick={() => unlinkChessMut.mutate()} disabled={unlinkChessMut.isPending}
                className="ml-auto text-rose-300 underline hover:text-rose-200 disabled:opacity-50">
                Unlink
              </button>
            </div>
          </div>
        )}

        {!cLinked && !cPending && !initInfo && (
          <div className="space-y-3">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Your Chess.com username</label>
            <div className="flex gap-2">
              <input value={cHandle} onChange={(e) => setCHandle(e.target.value)}
                placeholder="e.g. MagnusCarlsen"
                className="flex-1 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              <button onClick={() => initMut.mutate()} disabled={!cHandle || initMut.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {initMut.isPending ? "Checking…" : "Next →"}
              </button>
            </div>
            {cErr && <p className="text-xs text-rose-300">{cErr}</p>}
          </div>
        )}

        {(cPending || initInfo) && !cLinked && (
          <div className="space-y-3">
            {(() => {
              const info = initInfo ?? { verifyToken: (cPending as any).verifyToken, handle: (cPending as any).pendingHandle, instructions: `Set your Chess.com Location to: ${(cPending as any).verifyToken}` };
              return (
                <>
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                    <div className="mb-1 font-semibold">Verify ownership of <b>{info.handle}</b></div>
                    <ol className="ml-4 list-decimal space-y-1 text-xs text-amber-200">
                      <li>Open your Chess.com profile → <b>Settings → Profile</b>.</li>
                      <li>In the <b>Location</b> field, paste this token: <code className="rounded bg-black/40 px-1 py-0.5 text-amber-100">{info.verifyToken}</code></li>
                      <li>Save, then click <b>Verify</b> below. Once verified you can remove the token.</li>
                    </ol>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => verifyMut.mutate()} disabled={verifyMut.isPending}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                      {verifyMut.isPending ? "Verifying…" : "I've added the token · Verify"}
                    </button>
                    <button onClick={() => { unlinkChessMut.mutate(); }} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:bg-ink-800">
                      Cancel
                    </button>
                  </div>
                  {cErr && <p className="text-xs text-rose-300">{cErr}</p>}
                </>
              );
            })()}
          </div>
        )}
      </section>

      {(l || cLinked) && (
        <div className="flex items-center justify-between rounded-xl2 border border-ink-700 bg-ink-900 p-4 text-sm">
          <div>
            <div className="font-semibold text-white">Recent games</div>
            <div className="text-xs text-ink-400">Games imported from your linked accounts. A viewer is coming soon.</div>
          </div>
          <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}
            className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-700 disabled:opacity-50">
            {refreshMut.isPending ? "Refreshing…" : "⟳ Refresh games"}
          </button>
        </div>
      )}

      <p className="text-xs text-ink-500">
        <Link to="/dashboard" className="text-brand-400 hover:underline">← Back to dashboard</Link>
      </p>
    </div>
  );
}
