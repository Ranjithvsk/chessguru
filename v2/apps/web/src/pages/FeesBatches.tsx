// /fees/batches — batch management moved out of AcademyDashboard (2026-08-30).
//
// A batch groups students under a coach so:
//   * Recurring classes can be scheduled for the group in one form.
//   * A fee program can be attached to it and every student enrolled in one
//     click (see /fees/programs → BatchLink → "Enrol from batch").
//
// Data: `academyBatches` collection. API stays at /api/academy/batches (also
// consumed by /academy/attendance) — this page is a UI move, not an API move.

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import BatchesPanel, { type ClassRow } from "../components/BatchesPanel";

const t = (s: string) => s;

interface ScheduleResp { live: ClassRow[]; upcoming: ClassRow[] }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`/v2api${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export default function FeesBatchesPage() {
  // /auth/* is outside the /api global prefix — the endpoint is /auth/me,
  // not /api/auth/me. (Same URL every other page uses via api.ts.)
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => get<any>("/auth/me") });
  const students = useQuery({ queryKey: ["academy-students"], queryFn: () => get<any[]>("/api/academy/students") });
  const coaches = useQuery({ queryKey: ["academy-coaches"], queryFn: () => get<any[]>("/api/academy/coaches") });
  const schedule = useQuery({ queryKey: ["academy-schedule"], queryFn: () => get<ScheduleResp>("/api/class/schedule") });

  // /api/auth/me returns { loggedIn, userId, role, academyId, ... } flat — not
  // nested under a `user` object. Same shape used by every other page.
  const me = meQ.data;
  const role = me?.role;
  const isOwner = role === "academy_owner" || !!me?.admin;
  const canManage = isOwner || role === "coach";

  if (meQ.isLoading || students.isLoading || coaches.isLoading || schedule.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="animate-pulse rounded-2xl border border-ink-700 bg-ink-900/60 p-8 text-center text-sm text-ink-400">{t("Loading batches…")}</div>
      </div>
    );
  }
  if (!canManage) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-8 text-center text-sm text-ink-400">{t("Batches are only visible to academy owners and coaches.")}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Link to="/fees" className="text-ink-300 hover:text-white">← {t("Fees")}</Link>
        <span className="text-ink-500">/</span>
        <span className="text-ink-300">{t("Batches")}</span>
      </div>
      <header className="mb-6">
        <h1 className="font-display text-3xl text-ink-100 sm:text-4xl">👥 {t("Batches")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-300">
          {t("Group students under a coach. Every batch can be scheduled as recurring classes and attached to a fee program for one-click enrolment.")}
        </p>
      </header>

      <BatchesPanel
        students={students.data ?? []}
        coaches={coaches.data ?? []}
        isOwner={!!isOwner}
        classes={[...(schedule.data?.live ?? []), ...(schedule.data?.upcoming ?? [])]}
      />
    </div>
  );
}

