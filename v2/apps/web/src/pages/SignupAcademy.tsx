// /signup-academy — the front door for owner sign-ups. Shows what you get
// BEFORE asking for a name and password: hero, per-category feature grid with
// screenshots, "what's new" strip populated from /api/announcements, pricing
// (3 months free → ₹1000/month unlimited), then the signup form.
//
// Screenshot files live under /public/feature-shots/<id>.png. Missing images
// gracefully fall back to a gradient tile with the feature emoji so the page
// never looks broken on a fresh install.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FEATURES_BY_CATEGORY, CATEGORY_META, type FeatureCategory, type Feature,
} from "../lib/features";

type FieldErr = string | null;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ""}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

interface Announcement {
  id: string; title: string; body: string;
  ctaLabel: string | null; ctaUrl: string | null;
  category: string | null; emoji: string | null;
  publishedAt: string;
}

const CATEGORY_ORDER: FeatureCategory[] = [
  "puzzles", "classes", "academy", "analytics", "study", "engagement", "notifications", "play",
];

function FeatureShot({ f }: { f: Feature }) {
  // Try the screenshot; fall back to the emoji tile if it 404s. Handled with
  // onError on the <img> so we don't need a HEAD request per card.
  const [failed, setFailed] = useState(false);
  const src = `/feature-shots/${f.id}.png`;
  return (
    <div className={`aspect-[3/2] w-full overflow-hidden rounded-t-xl2 bg-gradient-to-br ${CATEGORY_META[f.category].gradient}`}>
      {failed ? (
        <div className="grid h-full w-full place-items-center text-6xl opacity-80">{f.emoji}</div>
      ) : (
        <img
          src={src}
          alt={f.title}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          loading="lazy"
        />
      )}
    </div>
  );
}

function FeatureCard({ f }: { f: Feature }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl2 border border-ink-700 bg-ink-900/60 transition hover:border-brand-500/50 hover:bg-ink-900">
      <FeatureShot f={f} />
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{f.emoji}</span>
            <h3 className="font-display text-sm font-semibold text-white">{f.title}</h3>
          </div>
          {f.badge && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              f.badge === "NEW" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"
            }`}>{f.badge}</span>
          )}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{f.description}</p>
      </div>
    </div>
  );
}

function CategorySection({ cat }: { cat: FeatureCategory }) {
  const meta = CATEGORY_META[cat];
  const items = FEATURES_BY_CATEGORY[cat];
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <header>
        <h2 className="font-display text-xl text-white">{meta.label}</h2>
        <p className="text-sm text-ink-400">{meta.blurb}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f) => <FeatureCard key={f.id} f={f} />)}
      </div>
    </section>
  );
}

function WhatsNewStrip({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-2xl border border-brand-500/30 bg-gradient-to-r from-brand-600/15 via-purple-500/10 to-transparent p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg text-white">✨ What's new</h2>
        <span className="text-xs text-ink-500">last {items.length} update{items.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {items.slice(0, 3).map((a) => (
          <div key={a.id} className="rounded-xl border border-ink-700 bg-ink-900 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span>{a.emoji || "✨"}</span>
              <span>{a.title}</span>
            </div>
            <p className="mt-1 line-clamp-3 text-xs text-ink-400">{a.body}</p>
            <div className="mt-2 text-[10px] uppercase tracking-wide text-ink-500">
              {new Date(a.publishedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PricingCard() {
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-brand-500/10 p-6 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex-1 min-w-[220px]">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-300">Simple pricing</div>
          <div className="mt-1 font-display text-3xl text-white">3 months free, then <span className="text-amber-300">₹1,000</span>/month</div>
          <p className="mt-2 text-sm text-ink-300">
            Try every feature with your whole academy for 90 days. No credit card up front.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-ink-200">
            <li>✅ Unlimited coaches</li>
            <li>✅ Unlimited students</li>
            <li>✅ Unlimited classes + recordings</li>
            <li>✅ All puzzle + study + analytics features included</li>
            <li>✅ Cancel or downgrade anytime</li>
          </ul>
        </div>
        <a href="#signup" className="shrink-0 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-lg hover:brightness-110">
          Start free trial →
        </a>
      </div>
    </section>
  );
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

  const { data: announcements } = useQuery({
    queryKey: ["announcements"], queryFn: () => get<Announcement[]>("/api/announcements?limit=5"),
    staleTime: 5 * 60_000,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await post<{ ok: boolean; error?: string; academyName?: string }>("/auth/signup-academy",
        { academyName, ownerName, ownerEmail, password });
      if (!r.ok) { setErr(r.error || "Signup failed."); return; }
      qc.removeQueries();
      window.location.href = "/academy";
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-10 py-6">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-brand-500/30 bg-gradient-to-br from-brand-600/20 via-purple-500/10 to-amber-500/5 p-8 text-center shadow-2xl">
        <div className="text-5xl">🏛️</div>
        <h1 className="mt-3 font-display text-4xl font-bold text-white">
          Run your chess academy on <span className="bg-gradient-to-r from-brand-300 via-purple-300 to-amber-300 bg-clip-text text-transparent">ChessGuru</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-ink-200">
          Everything you need to teach, coach, and grow — puzzles, study, live video classes, per-student analytics,
          fees + attendance, and a delight-loop of streaks and celebrations that keeps students coming back.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-ink-300">
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">3 months free trial</span>
          <span className="rounded-full bg-brand-500/15 px-3 py-1 text-brand-200">₹1,000/month after</span>
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-200">Unlimited everything</span>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <a href="#signup" className="rounded-lg bg-gradient-to-r from-brand-500 to-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg hover:brightness-110">
            Start free trial
          </a>
          <a href="#features" className="rounded-lg border border-ink-600 px-6 py-2.5 text-sm text-white hover:bg-ink-800">
            See features
          </a>
        </div>
      </section>

      {/* ── What's new ─────────────────────────────────────────── */}
      {announcements && announcements.length > 0 && <WhatsNewStrip items={announcements} />}

      {/* ── Pricing (top) ──────────────────────────────────────── */}
      <PricingCard />

      {/* ── Features by category ───────────────────────────────── */}
      <div id="features" className="space-y-10">
        {CATEGORY_ORDER.map((cat) => <CategorySection key={cat} cat={cat} />)}
      </div>

      {/* ── Pricing (bottom, near signup) ──────────────────────── */}
      <PricingCard />

      {/* ── Signup form ────────────────────────────────────────── */}
      <section id="signup" className="mx-auto max-w-lg scroll-mt-6">
        <div className="rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-xl">
          <div className="mb-1 text-2xl">🏛️</div>
          <h1 className="mb-1 font-display text-2xl text-white">Create your Academy</h1>
          <p className="mb-6 text-sm text-ink-400">
            Sign up as the academy owner — you can invite coaches and enroll students right after.
            <b> Free for 90 days</b>. No card required.
          </p>

          {err && (
            <div className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Academy name</label>
              <input required value={academyName} onChange={(e) => setAcademyName(e.target.value)}
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
              <p className="mt-1 text-[11px] text-ink-500">Used for password reset + trial expiry + feature updates.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Password</label>
              <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
            </div>

            <button disabled={busy} type="submit"
              className="w-full rounded-lg bg-gradient-to-r from-brand-500 to-purple-500 py-3 text-base font-semibold text-white shadow-lg hover:brightness-110 disabled:opacity-50">
              {busy ? "Creating…" : "Create academy — start 90-day trial →"}
            </button>
          </form>

          <div className="mt-6 border-t border-ink-800 pt-4 text-center text-sm text-ink-400">
            Already have an account? <Link to="/login" className="text-brand-400 hover:underline">Sign in</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
