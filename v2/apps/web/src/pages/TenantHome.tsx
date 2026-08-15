// White-labeled tenant landing page. Accessed at /a/:slug.
//
// Public homepage. Until super-admin approves the academy for white-labeling
// via /admin/whitelabel, this page shows ChessGuru branding with a subtle
// "This academy is powered by ChessGuru" note. Once approved, the academy's
// own brandName/logo/color/coach info/trophy gallery display publicly.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

type Brand = {
  slug: string;
  name: string;
  approved: boolean;
  brandName: string;
  brandColor: string;
  tagline: string;
  logoDataUrl: string | null;
  coachName: string;
  coachBio: string;
  coachAchievements: string[];
  coachPhotoDataUrl: string | null;
  trophyGallery: { imageDataUrl: string; caption: string }[];
};

export default function TenantHomePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const nav = useNavigate();

  useEffect(() => {
    let cancelled = false;
    // Two-tier lookup: prefer the dedicated brand endpoint; if it 404s (not
    // implemented for this tenant), fall back to /api/academy-page/:slug which
    // returns the same identity fields we need for the tenant home chrome.
    const fromPage = (j: any): Brand => ({
      slug: j?.academy?.slug || j?.academy?._id || slug,
      name: j?.profile?.displayName || j?.academy?.name || slug,
      approved: true,
      brandName: j?.profile?.displayName || j?.academy?.name || slug,
      brandColor: "#14a2b8",
      tagline: j?.profile?.tagline || "",
      logoDataUrl: j?.profile?.logoUrl || null,
      coachName: "",
      coachBio: j?.profile?.description || "",
      coachAchievements: (j?.profile?.achievements || []).map((a: any) => a?.title).filter(Boolean),
      coachPhotoDataUrl: null,
      trophyGallery: (j?.profile?.achievements || []).map((a: any) => ({ imageDataUrl: a?.imageUrl || "", caption: a?.title || "" })).filter((x: any) => x.imageDataUrl),
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

  if (notFound) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="mb-2 font-display text-xl text-white">Academy not found</h1>
        <p className="text-sm text-ink-400">No academy with the slug <b>{slug}</b> exists.</p>
        <Link to="/" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Go to ChessGuru</Link>
      </div>
    );
  }
  if (!brand) return <div className="mx-auto max-w-md py-16 text-center text-ink-400">Loading…</div>;

  const signedIn = !!auth?.loggedIn;
  const color = brand.brandColor;

  return (
    <div className="min-h-[70vh] flex flex-col" style={{ ["--tenant-color" as any]: color }}>
      {/* Hero */}
      <div className="relative pb-12 pt-16 text-center"
        style={{ background: `radial-gradient(ellipse at top, ${color}30 0%, transparent 60%)` }}>
        {brand.logoDataUrl ? (
          <img src={brand.logoDataUrl} alt={brand.brandName}
            className="mx-auto mb-6 h-24 w-24 rounded-full object-cover ring-4"
            style={{ ["--tw-ring-color" as any]: color + "80" }} />
        ) : (
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full text-5xl font-black text-white"
            style={{ background: color }}>
            {brand.brandName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <h1 className="font-display text-4xl font-bold text-white sm:text-5xl">{brand.brandName}</h1>
        {brand.tagline && <p className="mx-auto mt-3 max-w-xl px-4 text-lg text-ink-300">{brand.tagline}</p>}
        <div className="mt-8 flex justify-center gap-3">
          {signedIn ? (
            <button onClick={() => nav("/dashboard")}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
              style={{ background: color }}>
              Enter portal →
            </button>
          ) : (
            <Link to={`/a/${slug}/login`}
              className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
              style={{ background: color }}>
              Sign in
            </Link>
          )}
          {/* "New here?" (signup-academy) removed on tenant page — visitors here
              are prospective students of THIS academy, not owners of a new one. */}
        </div>
        {!brand.approved && (
          <p className="mx-auto mt-6 max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            ⏳ This academy is pending white-label approval by ChessGuru. Until then, the ChessGuru brand is shown publicly. Owners see their custom brand only via preview.
          </p>
        )}
      </div>

      {/* Meet the coach (only if academy provided info + is approved) */}
      {brand.approved && (brand.coachName || brand.coachAchievements.length > 0) && (
        <section className="mx-auto max-w-4xl px-4 py-10">
          <h2 className="mb-4 font-display text-2xl text-white">Meet the coach</h2>
          <div className="flex flex-col gap-6 rounded-xl2 border border-ink-700 bg-ink-900 p-6 sm:flex-row">
            {brand.coachPhotoDataUrl ? (
              <img src={brand.coachPhotoDataUrl} alt={brand.coachName}
                className="h-40 w-40 flex-shrink-0 rounded-full object-cover ring-2"
                style={{ ["--tw-ring-color" as any]: color + "70" }} />
            ) : (
              <div className="flex h-40 w-40 flex-shrink-0 items-center justify-center rounded-full bg-ink-800 text-4xl font-black text-ink-500">
                {(brand.coachName || "C").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              {brand.coachName && <h3 className="mb-1 text-xl font-semibold text-white">{brand.coachName}</h3>}
              {brand.coachBio && <p className="mb-3 text-sm text-ink-300 leading-relaxed whitespace-pre-line">{brand.coachBio}</p>}
              {brand.coachAchievements.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {brand.coachAchievements.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span style={{ color }} className="flex-shrink-0">🏅</span>
                      <span className="text-ink-200">{a}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Trophy / medal gallery (only when approved) */}
      {brand.approved && brand.trophyGallery.length > 0 && (
        <section className="mx-auto max-w-4xl px-4 py-6">
          <h2 className="mb-4 font-display text-2xl text-white">Trophy hall</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {brand.trophyGallery.map((t, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
                <img src={t.imageDataUrl} alt={t.caption} className="h-40 w-full object-cover" />
                {t.caption && <p className="p-2 text-[11px] text-ink-300">{t.caption}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* What we teach — generic feature grid */}
      <div className="mx-auto grid max-w-4xl gap-4 px-4 py-8 sm:grid-cols-3">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-2 text-2xl">📚</div>
          <h3 className="mb-1 font-semibold text-white">Learn openings</h3>
          <p className="text-xs text-ink-400">Master 500 top openings by frequency.</p>
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-2 text-2xl">🎯</div>
          <h3 className="mb-1 font-semibold text-white">Solve puzzles</h3>
          <p className="text-xs text-ink-400">Rated tactics that adapt to your level.</p>
        </div>
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-2 text-2xl">🏆</div>
          <h3 className="mb-1 font-semibold text-white">Play + Review</h3>
          <p className="text-xs text-ink-400">Play, get coach feedback, get better.</p>
        </div>
      </div>

      <div className="mt-auto py-6 text-center text-[11px] text-ink-500">
        Powered by <a href="https://harinitharanjith.com/signup-academy" target="_blank" rel="noreferrer" className="underline hover:text-ink-300">ChessGuru</a>
      </div>
    </div>
  );
}
