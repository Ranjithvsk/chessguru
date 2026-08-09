// Q1 SaaS foundation: post-signup landing for an academy owner (and later,
// coach) — a shell that will grow into the full "manage my academy" surface
// (coaches, students, attendance, classes, tournaments, billing).
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function AcademyDashboardPage() {
  const { data: me, isLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });

  if (isLoading) return <div className="py-16 text-center text-ink-400">Loading…</div>;
  if (!me?.loggedIn) return <Navigate to="/login" replace />;
  if (!me.academyId) {
    return (
      <div className="mx-auto max-w-lg py-8">
        <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-8 text-center">
          <div className="mb-2 text-3xl">🏛️</div>
          <h1 className="mb-2 font-display text-xl text-white">No academy yet</h1>
          <p className="mb-5 text-sm text-ink-400">You aren't a member of an academy — create one to get started.</p>
          <Link to="/signup-academy" className="inline-block rounded-lg bg-brand-600 px-5 py-2.5 font-semibold text-white hover:bg-brand-500">
            Create academy →
          </Link>
        </div>
      </div>
    );
  }

  const roleLabel = me.role === "academy_owner" ? "Owner"
                  : me.role === "coach"          ? "Coach"
                  : me.role === "student"        ? "Student"
                  : me.role || "Member";

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <header className="rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-300">🏛️ Academy · {roleLabel}</div>
        <h1 className="font-display text-2xl text-white">{me.academyId}</h1>
        <p className="mt-1 text-sm text-ink-400">Welcome, <b className="text-white">{me.username}</b>. Your academy is live.</p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <NextStepCard emoji="🧑‍🏫" title="Invite coaches" body="Add coaches to your academy — they'll get an email with a signup link." disabled />
        <NextStepCard emoji="👦" title="Enroll students" body="Add students under each coach. Students train with your academy's brand." disabled />
        <NextStepCard emoji="🎥" title="Schedule a class" body="Create a live video class — students join with one link, attendance auto-tracks." disabled />
      </section>

      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <h2 className="mb-1 font-display text-lg text-white">🚀 What's shipping this quarter</h2>
        <p className="mb-3 text-sm text-ink-400">Q1 features being rolled out — see PROJECT_MASTER/plans/CHESSGURU-SAAS-VISION.md for the full roadmap.</p>
        <ul className="grid gap-2 text-sm text-ink-200 md:grid-cols-2">
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Multi-tenant signup <span className="text-ink-500">— live</span></li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Coach invitations</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Student enrollment + rosters</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Per-student attendance rollup</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Per-academy class scheduling</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🔜 Billing skeleton (Razorpay)</li>
        </ul>
      </section>
    </div>
  );
}

function NextStepCard({ emoji, title, body, disabled }: { emoji: string; title: string; body: string; disabled?: boolean }) {
  return (
    <div className={`rounded-xl border border-ink-700 bg-ink-900 p-4 ${disabled ? "opacity-60" : ""}`}>
      <div className="mb-1 text-2xl">{emoji}</div>
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-1 text-xs text-ink-400">{body}</p>
      {disabled && <p className="mt-2 text-[10px] uppercase tracking-wide text-amber-400/80">Coming this week</p>}
    </div>
  );
}
