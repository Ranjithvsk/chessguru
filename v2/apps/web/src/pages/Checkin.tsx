// Student-facing QR check-in landing. URL is /checkin/:token — encoded into
// the QR the coach displays on their tablet at class start. Student scans →
// this page runs → auto-marks them present via POST /api/academy/attendance/qr/checkin.
//
// Auth: if student isn't signed in, redirect to /login?back=/checkin/:token so
// they land back here after signing in. Owner ask 2026-08-23.
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, post } from "../lib/api";

type CheckinResp = { ok: boolean; date?: string; name?: string; error?: string };

export default function CheckinPage() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const [result, setResult] = useState<CheckinResp | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!auth) return;
    if (!auth.loggedIn) {
      nav(`/login?back=/checkin/${encodeURIComponent(token || "")}`, { replace: true });
      return;
    }
    if (!token || result || running) return;
    setRunning(true);
    post<CheckinResp>(`/api/academy/attendance/qr/checkin`, { token })
      .then((res) => setResult(res))
      .catch((e) => setResult({ ok: false, error: e?.message || "Check-in failed." }))
      .finally(() => setRunning(false));
  }, [auth, token, nav, result, running]);

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-3 py-10">
      <div className="w-full rounded-2xl border border-ink-700 bg-gradient-to-b from-ink-900 to-ink-950 p-8 text-center shadow-2xl">
        {!auth && <div className="text-sm text-ink-500">Loading…</div>}
        {auth && auth.loggedIn && running && !result && (
          <>
            <div className="text-5xl">⏳</div>
            <div className="mt-3 text-lg font-semibold text-white">Checking you in…</div>
          </>
        )}
        {result && result.ok && (
          <>
            <div className="text-6xl">✅</div>
            <h1 className="mt-4 font-display text-2xl text-emerald-300">You're checked in!</h1>
            <p className="mt-2 text-sm text-ink-300">Welcome, <b className="text-white">{result.name}</b>. Enjoy the class 🎉</p>
            <p className="mt-1 text-xs text-ink-500">Date: {result.date}</p>
            <Link to="/" className="mt-6 inline-block rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
              🧩 Solve today's puzzles →
            </Link>
          </>
        )}
        {result && !result.ok && (
          <>
            <div className="text-6xl">⚠️</div>
            <h1 className="mt-4 font-display text-2xl text-rose-300">Check-in failed</h1>
            <p className="mt-2 text-sm text-ink-300">{result.error}</p>
            <p className="mt-2 text-xs text-ink-500">Ask your coach to show the QR again — or tell them you attended today.</p>
            <Link to="/" className="mt-6 inline-block rounded-lg border border-ink-700 px-5 py-2 text-sm font-semibold text-ink-300 hover:text-white">
              Go to home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
