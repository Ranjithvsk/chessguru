// White-labeled tenant login page. Accessed at /a/:slug/login.
//
// Fetches academy branding (name, logo, color, tagline) BEFORE showing the
// form so the user sees their academy's identity — not "ChessGuru". Uses
// the same sign-in endpoint under the hood; academy binding is inferred
// server-side from the user record's academyId, so no extra params needed.

import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Brand = {
  slug: string;
  name: string;
  brandName: string;
  brandColor: string;
  tagline: string;
  logoDataUrl: string | null;
};

// Infer tenant slug from the current custom domain (e.g. gunachess.com →
// "gunachess"). Used when this page is mounted at /login on a tenant host
// (no :slug in the URL) so the branded login still works.
function slugFromHost(): string {
  if (typeof window === "undefined") return "";
  const h = window.location.hostname.toLowerCase();
  if (/^(chessguru\.com|harinitharanjith\.com|localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/.test(h)) return "";
  return h.split(".")[0] || "";
}

export default function TenantLoginPage() {
  const { slug: paramSlug = "" } = useParams<{ slug: string }>();
  const slug = paramSlug || slugFromHost();
  const [params] = useSearchParams();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<"signin" | "otp">("signin");
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

  useEffect(() => {
    let cancelled = false;
    // Try the dedicated brand endpoint first; if it 404s (not implemented for
    // this tenant), fall back to /api/academy-page/:slug which returns the
    // same data shape (name + logo + tagline) as part of the public page.
    const fromPage = (j: any): Brand => ({
      slug: j?.academy?.slug || slug,
      name: j?.profile?.displayName || j?.academy?.name || slug,
      brandName: j?.profile?.displayName || j?.academy?.name || slug,
      brandColor: "#14a2b8",
      tagline: j?.profile?.tagline || "",
      logoDataUrl: j?.profile?.logoUrl || null,
    });
    fetch(`${API_BASE}/api/academy/brand/${encodeURIComponent(slug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => { if (!cancelled) setBrand(j); })
      .catch(() =>
        fetch(`${API_BASE}/api/academy-page/${encodeURIComponent(slug)}`)
          .then((r) => r.ok ? r.json() : Promise.reject(r.status))
          .then((j) => { if (!cancelled) setBrand(fromPage(j)); })
          .catch(() => { if (!cancelled) setNotFound(true); })
      );
    return () => { cancelled = true; };
  }, [slug]);

  const clearMsg = () => { setErr(""); setNote(""); };
  // After a tenant login, land students on the puzzle trainer (that's the
  // primary "logged-in" experience), not the tenant home dashboard which is
  // only useful for coaches/owners. A ?back= param still overrides.
  const back = params.get("back") || `/puzzles`;

  const submit = async () => {
    clearMsg(); setBusy(true);
    try {
      if (mode === "signin") {
        const r = await api.signin(username.trim(), password, keep, slug);
        if (r.ok) { await qc.invalidateQueries(); nav(back); }
        else setErr(r.error || "Something went wrong.");
      } else {
        if (!otpSent) {
          const r = await api.requestOtp(email.trim());
          if (r.ok) { setOtpSent(true); setNote("Check your email for a 6-digit code."); }
          else setErr(r.error || "Something went wrong.");
        } else {
          const r = await api.otpSignin(email.trim(), otp.trim(), slug);
          if (r.ok) { await qc.invalidateQueries(); nav(back); }
          else setErr(r.error || "Something went wrong.");
        }
      }
    } finally { setBusy(false); }
  };

  if (notFound) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="rounded-xl2 border border-rose-500/40 bg-rose-500/10 p-6 text-rose-100">
          <h1 className="mb-2 font-display text-xl">Academy not found</h1>
          <p className="text-sm">No academy with the slug <b>{slug}</b> exists.</p>
          <Link to="/login" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">
            Go to ChessGuru login
          </Link>
        </div>
      </div>
    );
  }

  if (!brand) {
    return <div className="mx-auto max-w-md py-16 text-center text-ink-400">Loading…</div>;
  }

  return (
    <div
      className="mx-auto max-w-md py-12 px-4"
      style={{ ["--tenant-color" as any]: brand.brandColor }}
    >
      <div className="mb-6 flex flex-col items-center text-center">
        {brand.logoDataUrl ? (
          <img
            src={brand.logoDataUrl}
            alt={brand.brandName}
            className="mb-4 h-20 w-20 rounded-full object-cover ring-4"
            style={{ ["--tw-ring-color" as any]: brand.brandColor + "80" }}
          />
        ) : (
          <div
            className="mb-4 flex h-20 w-20 items-center justify-center rounded-full text-3xl font-black text-white"
            style={{ background: brand.brandColor }}
          >
            {brand.brandName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <h1 className="font-display text-2xl text-white">{brand.brandName}</h1>
        {brand.tagline && <p className="mt-1 text-sm text-ink-400">{brand.tagline}</p>}
      </div>

      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6">
        <div className="mb-3 flex gap-2 text-xs">
          <button onClick={() => { setMode("signin"); clearMsg(); }}
            className={`flex-1 rounded-lg px-3 py-1.5 font-semibold ${mode === "signin" ? "text-white" : "text-ink-400 bg-ink-800"}`}
            style={mode === "signin" ? { background: brand.brandColor } : undefined}>
            Sign in
          </button>
          <button onClick={() => { setMode("otp"); clearMsg(); }}
            className={`flex-1 rounded-lg px-3 py-1.5 font-semibold ${mode === "otp" ? "text-white" : "text-ink-400 bg-ink-800"}`}
            style={mode === "otp" ? { background: brand.brandColor } : undefined}>
            Email code
          </button>
        </div>

        {mode === "signin" && (
          <div className="flex flex-col gap-3">
            <input placeholder="Username or email" value={username} onChange={(e) => setU(e.target.value)}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white outline-none focus:border-white/30" />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setP(e.target.value)}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white outline-none focus:border-white/30" />
            <label className="flex items-center gap-2 text-xs text-ink-400">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Keep me signed in
            </label>
          </div>
        )}
        {mode === "otp" && (
          <div className="flex flex-col gap-3">
            <input placeholder="Email address" value={email} onChange={(e) => setE(e.target.value)}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white outline-none focus:border-white/30" />
            {otpSent && (
              <input placeholder="6-digit code" value={otp} onChange={(e) => setOtp(e.target.value)}
                className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-white outline-none focus:border-white/30" />
            )}
          </div>
        )}

        {err && <p className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-100">{err}</p>}
        {note && <p className="mt-3 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100">{note}</p>}

        <button onClick={submit} disabled={busy}
          className="mt-4 w-full rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: brand.brandColor }}>
          {busy ? "…" : mode === "signin" ? "Sign in" : otpSent ? "Verify code" : "Send code"}
        </button>
      </div>

      <p className="mt-6 text-center text-[11px] text-ink-500">
        Powered by <a href="https://harinitharanjith.com/signup-academy" target="_blank" rel="noreferrer" className="underline hover:text-ink-300">ChessGuru</a>
      </p>
    </div>
  );
}
