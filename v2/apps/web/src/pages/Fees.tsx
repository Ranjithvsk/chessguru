// Fees landing (W1). A friendly placeholder that fronts the section until the
// real dashboard lands in W4 (KPI cards, live stream, charts). For W1 it just
// deep-links into the surfaces that exist so the owner has one clean entry.

import { Link } from "react-router-dom";

const t = (s: string) => s;

const TILES = [
  {
    to: "/fees/programs",
    emoji: "🎓",
    title: "Programs",
    desc: "Bundles of fee heads — Tuition, Exam, Book. Start here.",
    ring: "from-brand-600/40 via-brand-500/10 to-transparent",
    live: true,
  },
  {
    to: "/fees/enrollments",
    emoji: "👨‍👩‍👧",
    title: "Enrollments",
    desc: "Which students are on which programs.",
    ring: "from-accent-500/40 via-accent-500/10 to-transparent",
    live: false,
  },
  {
    to: "/fees/invoices",
    emoji: "🧾",
    title: "Invoices",
    desc: "Monthly bills, cash payments, reminders.",
    ring: "from-gold-500/40 via-gold-500/10 to-transparent",
    live: false,
  },
  {
    to: "/fees/payments",
    emoji: "💚",
    title: "Payments",
    desc: "Ledger + reconciliation with the PG.",
    ring: "from-emerald-500/40 via-emerald-500/10 to-transparent",
    live: false,
  },
  {
    to: "/fees/reports",
    emoji: "📊",
    title: "Reports",
    desc: "By month, class, head, defaulters. Tally export.",
    ring: "from-indigo-500/40 via-indigo-500/10 to-transparent",
    live: false,
  },
  {
    to: "/fees/settings",
    emoji: "⚙️",
    title: "Settings",
    desc: "Razorpay keys, GSTIN, receipt format, reminder cadence.",
    ring: "from-ink-500/40 via-ink-500/10 to-transparent",
    live: false,
  },
];

export default function FeesLanding() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-300 ring-1 ring-brand-400/30">
            {t("Beta · W1")}
          </span>
        </div>
        <h1 className="font-display text-4xl text-ink-100 sm:text-5xl">
          {t("Fees")}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-ink-300 sm:text-base">
          {t("Collect tuition, exam and book fees over WhatsApp / email / UPI — with receipts, dashboards, and a parent-facing wallet.")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => {
          const inner = (
            <div
              className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60 p-6 transition ${tile.live ? "hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-glow" : "opacity-70"}`}
            >
              <div className={`pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-gradient-to-br ${tile.ring} blur-2xl`} />
              <div className="mb-3 text-3xl" aria-hidden>{tile.emoji}</div>
              <h2 className="text-lg font-semibold text-ink-100">{t(tile.title)}</h2>
              <p className="mt-1 text-sm text-ink-300">{t(tile.desc)}</p>
              <div className="mt-auto pt-4">
                {tile.live ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent-400 ring-1 ring-accent-400/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
                    {t("live")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink-800 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    {t("coming soon")}
                  </span>
                )}
              </div>
            </div>
          );
          return tile.live ? (
            <Link key={tile.to} to={tile.to} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">{inner}</Link>
          ) : (
            <div key={tile.to} className="cursor-not-allowed" title={t("Coming soon")}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
