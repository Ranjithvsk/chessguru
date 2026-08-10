// Academy dashboard — owner + coach both use this page, with role-scoped panels.
//
//   OWNER sees: invite coach + invite student (pick coach), pending invites,
//               all coaches, all students, per-student "view perf" link.
//   COACH sees: invite student (auto-attaches to them), pending invites
//               (their own), their student roster, per-student "view perf".
//   STUDENT sees: thin shell (no management), full ChessGuru access as normal.
//
// All lists auto-refresh so accepted invites turn into real rows without a
// manual reload.
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import Board from "../components/Board";
import { api } from "../lib/api";

const BASE = import.meta.env.VITE_API_BASE ?? "";

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
async function del<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", credentials: "include" });
  return r.json() as Promise<T>;
}

interface Invite { token: string; email: string; displayName?: string; role: "coach"|"student"; coachId?: string|null; createdAt: string; expiresAt: string; invitedByName?: string }
interface Coach   { _id: string; username: string; email?: string|null; createdAt?: string; lastLogin?: string|null }
interface Student {
  _id: string; username: string; email?: string|null; coachId?: string|null;
  createdAt?: string; lastLogin?: string|null;
  puzzleRating?: number;
  // Attendance rollup from classAttendance (see AcademyService.listStudents)
  attendedTotal?: number; attendedThisWeek?: number; lastAttendedAt?: string|null;
  attendance30d?: boolean[];   // 30 booleans, index 0 = 29 days ago, 29 = today
  // Fees rollup from feeInvoices
  pendingFeesPaise?: number; oldestPendingPeriod?: string|null;
  // Phase 8e: puzzle activity snapshot
  puzzleSolves7d?: number; lastPuzzleAt?: string|null;
  dailyStreakCurrent?: number; dailyStreakLongest?: number;
}
// Mini 30-day attendance strip — 30 tiny cells, green when present.
function AttendanceStrip({ days }: { days?: boolean[] }) {
  const strip = (days && days.length === 30) ? days : new Array(30).fill(false);
  return (
    <div className="flex gap-[2px]" title="Last 30 days — green = attended a class">
      {strip.map((on, i) => (
        <div key={i} className={`w-[6px] h-[14px] rounded-[1px] ${on ? "bg-emerald-500" : "bg-ink-700"}`} />
      ))}
    </div>
  );
}
interface ClassRow { _id: string; title: string; coach: string; startAt: string; durationMin: number; mine?: boolean; attendedCount?: number; academyId?: string|null; summarySentAt?: string|null; autoSummary?: boolean; autoSummaryNote?: string; seriesId?: string|null; seriesIndex?: number; seriesTotal?: number; autoSummaryFailedAt?: string|null; autoSummaryFailedCount?: number; autoSummaryFailedError?: string }
interface FeesConfig { monthlyFeePaise: number; upiVpa: string; upiPayeeName: string; canEdit: boolean }
interface Invoice { _id: string; academyId: string; studentId: string; studentUsername: string; period: string; amountPaise: number; status: "pending"|"paid"|"waived"; generatedAt: string; paidAt?: string; paymentMethod?: string }
function rupees(paise: number) { return (paise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }); }
function upiIntent(o: { vpa: string; name: string; amountPaise: number; note: string }) {
  const p = new URLSearchParams({
    pa: o.vpa, pn: o.name, am: (o.amountPaise / 100).toFixed(2),
    cu: "INR", tn: o.note,
  });
  return `upi://pay?${p.toString()}`;
}
interface ScheduleResp { live: ClassRow[]; upcoming: ClassRow[] }
function fmtStartAt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleString(undefined, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function localDatetimeDefault() {
  // Default the scheduler form's startAt to the next quarter-hour, local time.
  const d = new Date();
  d.setMinutes(d.getMinutes() + (15 - d.getMinutes() % 15), 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDate(d?: string|null) { return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "—"; }
function fmtAgo(d?: string|null) {
  if (!d) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
}

export default function AcademyDashboardPage() {
  const { data: me, isLoading } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const isOwner = me?.role === "academy_owner";
  const isCoach = me?.role === "coach";
  const canManage = isOwner || isCoach;

  const qc = useQueryClient();

  const { data: invites } = useQuery({
    queryKey: ["academy-invites"], queryFn: () => get<Invite[]>("/api/academy/invites"),
    enabled: canManage, refetchInterval: 15_000,
  });
  const { data: coaches } = useQuery({
    queryKey: ["academy-coaches"], queryFn: () => get<Coach[]>("/api/academy/coaches"),
    enabled: !!isOwner, refetchInterval: 30_000,
  });
  const { data: students } = useQuery({
    queryKey: ["academy-students"], queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: canManage, refetchInterval: 30_000,
  });
  const { data: schedule } = useQuery({
    queryKey: ["academy-schedule"], queryFn: () => get<ScheduleResp>("/api/class/schedule"),
    enabled: !!me?.loggedIn, refetchInterval: 30_000,
  });
  const { data: recordings } = useQuery({
    queryKey: ["academy-recordings"],
    queryFn: () => get<Array<{ classId: string; title: string; startAt: string; filename: string; bytes: number; createdAt: string }>>("/api/academy/recordings"),
    enabled: canManage, refetchInterval: 60_000,
  });
  const { data: snaps } = useQuery({
    queryKey: ["academy-snaps"],
    queryFn: () => get<SnapItem[]>("/api/academy/snaps"),
    enabled: canManage, refetchInterval: 60_000,
  });
  const { data: feesConfig } = useQuery({
    queryKey: ["academy-fees-config"], queryFn: () => get<FeesConfig>("/api/academy/fees/config"),
    enabled: canManage,
  });
  const { data: invoices } = useQuery({
    queryKey: ["academy-fees"], queryFn: () => get<Invoice[]>("/api/academy/fees?status=pending"),
    enabled: canManage, refetchInterval: 30_000,
  });

  // Scheduler form
  const [classTitle, setClassTitle] = useState("");
  const [classCoach, setClassCoach] = useState("");
  const [classStartAt, setClassStartAt] = useState(localDatetimeDefault);
  const [classDur, setClassDur] = useState(60);
  const [classAutoSummary, setClassAutoSummary] = useState(false);
  const [classAutoSummaryNote, setClassAutoSummaryNote] = useState("");
  // "Last used" auto-summary defaults for the current user, persisted in
  // localStorage so scheduling a similar class next time is a one-tap
  // pre-fill. Keyed by userId so a shared browser doesn't cross-contaminate.
  const lastAutoKey = me?.userId ? `cg_last_autosummary_${me.userId}` : null;
  const [lastAutoDefault, setLastAutoDefault] = useState<{ note: string } | null>(null);
  useEffect(() => {
    if (!lastAutoKey) return;
    try {
      const raw = localStorage.getItem(lastAutoKey);
      if (raw) { const j = JSON.parse(raw); if (j && typeof j.note === "string") setLastAutoDefault({ note: j.note }); }
    } catch { /* private mode */ }
  }, [lastAutoKey]);
  const [scheduleMsg, setScheduleMsg] = useState<{ tone: "ok"|"err"; text: string }|null>(null);
  // Fees form + actions
  const [feeRupees, setFeeRupees] = useState<string>("");
  const [feeVpa, setFeeVpa] = useState("");
  const [feePayeeName, setFeePayeeName] = useState("");
  useEffect(() => {
    if (feesConfig) {
      setFeeRupees(feesConfig.monthlyFeePaise ? String(feesConfig.monthlyFeePaise / 100) : "");
      setFeeVpa(feesConfig.upiVpa || "");
      setFeePayeeName(feesConfig.upiPayeeName || "");
    }
  }, [feesConfig]);
  const [feesMsg, setFeesMsg] = useState<{ tone: "ok"|"err"; text: string }|null>(null);
  const saveFeesMut = useMutation({
    mutationFn: () => fetch(`${BASE}/api/academy/fees/config`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyFeePaise: Math.round(Number(feeRupees) * 100) || 0,
        upiVpa: feeVpa, upiPayeeName: feePayeeName,
      }),
    }).then((r) => r.json()),
    onSuccess: (r: any) => {
      setFeesMsg(r.ok ? { tone: "ok", text: "Fees config saved." } : { tone: "err", text: r.error || "Save failed." });
      qc.invalidateQueries({ queryKey: ["academy-fees-config"] });
    },
  });
  const generateMut = useMutation({
    mutationFn: () => post<{ ok: boolean; generated?: number; period?: string; pendingCount?: number; error?: string }>("/api/academy/fees/generate"),
    onSuccess: (r) => {
      setFeesMsg(r.ok
        ? { tone: "ok", text: `Generated invoices for ${r.period} — ${r.pendingCount} still pending.` }
        : { tone: "err", text: r.error || "Generate failed." });
      qc.invalidateQueries({ queryKey: ["academy-fees"] });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });
  const markPaidMut = useMutation({
    mutationFn: (id: string) => post<{ ok: boolean; error?: string }>(`/api/academy/fees/${encodeURIComponent(id)}/mark-paid`, { paymentMethod: "upi" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["academy-fees"] });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });

  const scheduleMut = useMutation({
    mutationFn: () => post<{ _id: string; title: string }>("/api/class/schedule", {
      title: classTitle, coach: classCoach || (me?.username ?? ""), startAt: new Date(classStartAt).toISOString(), durationMin: classDur,
      autoSummary: classAutoSummary,
      autoSummaryNote: classAutoSummary ? classAutoSummaryNote : "",
    }),
    onSuccess: (r: any) => {
      if (r && r._id) {
        setScheduleMsg({ tone: "ok", text: `"${r.title}" scheduled — join link ready.` });
        setClassTitle(""); setClassCoach(""); setClassStartAt(localDatetimeDefault()); setClassDur(60);
        // Persist autoSummary settings for next-time one-click restore.
        if (classAutoSummary && lastAutoKey) {
          try { localStorage.setItem(lastAutoKey, JSON.stringify({ note: classAutoSummaryNote })); setLastAutoDefault({ note: classAutoSummaryNote }); }
          catch { /* private mode */ }
        }
      } else {
        setScheduleMsg({ tone: "err", text: (r as any)?.message || "Schedule failed." });
      }
      qc.invalidateQueries({ queryKey: ["academy-schedule"] });
    },
  });

  // Invite forms
  const [coachEmail, setCoachEmail] = useState("");
  const [coachName, setCoachName] = useState("");
  const [studEmail, setStudEmail] = useState("");
  const [studName, setStudName] = useState("");
  const [studCoachId, setStudCoachId] = useState("");
  const [inviteMsg, setInviteMsg] = useState<{ tone: "ok"|"err"; text: string }|null>(null);

  const inviteCoachMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; invite?: { mail: string } }>("/api/academy/invites",
      { email: coachEmail, displayName: coachName, role: "coach" }),
    onSuccess: (r) => {
      if (!r.ok) setInviteMsg({ tone: "err", text: r.error || "Invite failed." });
      else { setInviteMsg({ tone: "ok", text: `Coach invite sent to ${coachEmail}.` }); setCoachEmail(""); setCoachName(""); }
      qc.invalidateQueries({ queryKey: ["academy-invites"] });
    },
  });
  const inviteStudentMut = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string; invite?: { mail: string } }>("/api/academy/invites",
      { email: studEmail, displayName: studName, role: "student", coachId: isOwner ? studCoachId : undefined }),
    onSuccess: (r) => {
      if (!r.ok) setInviteMsg({ tone: "err", text: r.error || "Invite failed." });
      else { setInviteMsg({ tone: "ok", text: `Student invite sent to ${studEmail}.` }); setStudEmail(""); setStudName(""); setStudCoachId(""); }
      qc.invalidateQueries({ queryKey: ["academy-invites"] });
    },
  });
  const revokeMut = useMutation({
    mutationFn: (token: string) => del<{ ok: boolean }>(`/api/academy/invites/${encodeURIComponent(token)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["academy-invites"] }),
  });

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

  const roleLabel = isOwner ? "Owner" : isCoach ? "Coach" : me.role === "student" ? "Student" : (me.role || "Member");
  const studentsShown = students ?? [];
  const coachById = Object.fromEntries((coaches ?? []).map((c) => [c._id, c.username]));

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <header className="rounded-xl2 border border-brand-500/30 bg-gradient-to-br from-brand-500/10 via-ink-900 to-ink-900 p-6">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-300">🏛️ Academy · {roleLabel}</div>
        <h1 className="font-display text-2xl text-white">{me.academyId}</h1>
        <p className="mt-1 text-sm text-ink-400">Welcome, <b className="text-white">{me.username}</b>.</p>
      </header>

      {canManage && <TodayStrip schedule={schedule} snaps={snaps} recordings={recordings} />}
      {canManage && <ReviewHeatmapStrip snaps={snaps} />}
      {canManage && <SnapVolumeChart snaps={snaps} />}
      {canManage && <NextUpToReview snaps={snaps} />}
      {canManage && <StarredDigestPreviewLink />}

      {/* ── Invite forms ── */}
      {canManage && (
        <section className="space-y-4">
          {isOwner && (
            <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-display text-lg text-white">🧑‍🏫 Invite a coach</h2>
                <span className="text-xs text-ink-500">7-day signup link via email</span>
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <input type="email" placeholder="coach@example.com" value={coachEmail}
                  onChange={(e) => setCoachEmail(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                <input type="text" placeholder="Display name (e.g. Coach Priya)" value={coachName}
                  onChange={(e) => setCoachName(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                <button disabled={!coachEmail || inviteCoachMut.isPending} onClick={() => inviteCoachMut.mutate()}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                  {inviteCoachMut.isPending ? "Sending…" : "Invite coach"}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="font-display text-lg text-white">👦 Invite a student</h2>
              <span className="text-xs text-ink-500">
                {isCoach ? "They'll be assigned to you" : "Pick which coach the student joins"}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input type="email" placeholder="parent@example.com" value={studEmail}
                onChange={(e) => setStudEmail(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              <input type="text" placeholder="Student display name (e.g. Aarav K)" value={studName}
                onChange={(e) => setStudName(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
              {isOwner && (
                <select value={studCoachId} onChange={(e) => setStudCoachId(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none md:col-span-2">
                  <option value="">— pick a coach for this student —</option>
                  {(coaches ?? []).map((c) => <option key={c._id} value={c._id}>{c.username}{c.email ? ` (${c.email})` : ""}</option>)}
                </select>
              )}
              <button disabled={!studEmail || (isOwner && !studCoachId) || inviteStudentMut.isPending}
                onClick={() => inviteStudentMut.mutate()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 md:col-span-2">
                {inviteStudentMut.isPending ? "Sending…" : "Invite student"}
              </button>
            </div>
          </div>

          {inviteMsg && (
            <p className={`text-xs ${inviteMsg.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{inviteMsg.text}</p>
          )}
        </section>
      )}

      {/* ── Pending invites ── */}
      {canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-3 font-display text-lg text-white">✉️ Pending invites <span className="text-xs text-ink-500">({invites?.length ?? 0})</span></h2>
          {(!invites || invites.length === 0) && <p className="text-sm text-ink-400">No pending invites.</p>}
          {invites && invites.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">Coach</th>
                    <th className="px-3 py-2 text-left">Sent</th>
                    <th className="px-3 py-2 text-left">Expires</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.token} className="border-t border-ink-800">
                      <td className="px-3 py-2 text-white">{inv.email}<div className="text-[11px] text-ink-500">{inv.displayName || ""}</div></td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${inv.role === "coach" ? "bg-brand-500/15 text-brand-100" : "bg-emerald-500/15 text-emerald-200"}`}>{inv.role}</span></td>
                      <td className="px-3 py-2 text-ink-300">{inv.role === "student" && inv.coachId ? (coachById[inv.coachId] ?? inv.coachId) : "—"}</td>
                      <td className="px-3 py-2 text-ink-400">{fmtDate(inv.createdAt)}</td>
                      <td className="px-3 py-2 text-ink-400">{fmtDate(inv.expiresAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => revokeMut.mutate(inv.token)}
                          className="text-xs text-rose-300 underline hover:text-rose-200">Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Coaches (owner only) ── */}
      {isOwner && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-3 font-display text-lg text-white">👥 Coaches <span className="text-xs text-ink-500">({coaches?.length ?? 0})</span></h2>
          {(!coaches || coaches.length === 0) && <p className="text-sm text-ink-400">No coaches yet.</p>}
          {coaches && coaches.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Username</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Joined</th>
                    <th className="px-3 py-2 text-left">Last login</th>
                    <th className="px-3 py-2 text-left"># students</th>
                  </tr>
                </thead>
                <tbody>
                  {coaches.map((c) => {
                    const n = studentsShown.filter((s) => s.coachId === c._id).length;
                    return (
                      <tr key={c._id} className="border-t border-ink-800">
                        <td className="px-3 py-2 text-white">{c.username}</td>
                        <td className="px-3 py-2 text-ink-300">{c.email || "—"}</td>
                        <td className="px-3 py-2 text-ink-400">{fmtDate(c.createdAt)}</td>
                        <td className="px-3 py-2 text-ink-400">{fmtAgo(c.lastLogin)}</td>
                        <td className="px-3 py-2 text-ink-300 tabular-nums">{n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Students (owner sees all, coach sees theirs) ── */}
      {canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="font-display text-lg text-white">
              👦 {isCoach ? "My students" : "Students"} <span className="text-xs text-ink-500">({studentsShown.length})</span>
            </h2>
            {studentsShown.length > 0 && (
              <button onClick={() => {
                // Roster snapshot: joined-when, contact, puzzle rating,
                // attendance rollup, pending fees. Enough for a parent
                // meeting or a report-card prep without opening the app.
                const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
                const header = ["Username", "Email", "CoachId", "JoinedAt", "LastLogin", "PuzzleRating",
                  "AttendedTotal", "AttendedThisWeek", "LastAttendedAt", "PendingFeesINR", "OldestPendingPeriod"];
                const lines = [header.map(esc).join(",")];
                for (const s of studentsShown) {
                  lines.push([
                    s.username,
                    s.email || "",
                    s.coachId || "",
                    s.createdAt ? new Date(s.createdAt).toISOString() : "",
                    s.lastLogin ? new Date(s.lastLogin).toISOString() : "",
                    s.puzzleRating != null ? String(s.puzzleRating) : "",
                    s.attendedTotal != null ? String(s.attendedTotal) : "",
                    s.attendedThisWeek != null ? String(s.attendedThisWeek) : "",
                    s.lastAttendedAt ? new Date(s.lastAttendedAt).toISOString() : "",
                    s.pendingFeesPaise != null ? (s.pendingFeesPaise / 100).toFixed(2) : "",
                    s.oldestPendingPeriod || "",
                  ].map((c) => esc(String(c))).join(","));
                }
                const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
                title="Download the student roster as CSV"
                className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-ink-100">
                ⬇ CSV <span className="ml-1 opacity-70">{studentsShown.length}</span>
              </button>
            )}
          </div>
          {studentsShown.length === 0 && (
            <p className="text-sm text-ink-400">
              No students yet. {isCoach ? "Invite one above." : "Owners invite students and pick which coach they join."}
            </p>
          )}
          {studentsShown.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Username</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    {isOwner && <th className="px-3 py-2 text-left">Coach</th>}
                    <th className="px-3 py-2 text-left">Rating</th>
                    <th className="px-3 py-2 text-left" title="Solves in last 7d · daily-puzzle streak">Puzzle activity</th>
                    <th className="px-3 py-2 text-left" title="Classes attended (all-time · this week)">Attendance</th>
                    <th className="px-3 py-2 text-left">Fees pending</th>
                    <th className="px-3 py-2 text-left">Last active</th>
                    <th className="px-3 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {studentsShown.map((s) => {
                    const att = s.attendedTotal ?? 0;
                    const wk  = s.attendedThisWeek ?? 0;
                    return (
                      <tr key={s._id} className="border-t border-ink-800">
                        <td className="px-3 py-2 text-white">{s.username}</td>
                        <td className="px-3 py-2 text-ink-300">{s.email || "—"}</td>
                        {isOwner && <td className="px-3 py-2 text-ink-300">{s.coachId ? (coachById[s.coachId] ?? s.coachId) : "—"}</td>}
                        <td className="px-3 py-2 text-white tabular-nums">{s.puzzleRating ?? 1500}</td>
                        <td className="px-3 py-2 tabular-nums" title={`Last solve: ${s.lastPuzzleAt ? new Date(s.lastPuzzleAt).toLocaleString() : "never"}`}>
                          <div className="flex flex-col gap-0.5">
                            {(s.puzzleSolves7d ?? 0) === 0 ? (
                              <span className="text-ink-500">—</span>
                            ) : (
                              <span className="text-white">
                                {s.puzzleSolves7d}
                                <span className="ml-1 text-[10px] text-ink-400">/ 7d</span>
                              </span>
                            )}
                            {(s.dailyStreakCurrent ?? 0) > 0 ? (
                              <span className="text-[10px] text-orange-300">🔥 {s.dailyStreakCurrent}-day daily</span>
                            ) : (s.dailyStreakLongest ?? 0) > 0 ? (
                              <span className="text-[10px] text-ink-500">🔥 best {s.dailyStreakLongest}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 tabular-nums" title={`Last attended: ${s.lastAttendedAt ? new Date(s.lastAttendedAt).toLocaleString() : "never"}`}>
                          <div className="flex flex-col gap-1">
                            {att === 0 ? (
                              <span className="text-ink-500">—</span>
                            ) : (
                              <span className="text-white">
                                {att}
                                {wk > 0 && <span className="ml-1 text-[10px] text-emerald-300">· {wk} this wk</span>}
                              </span>
                            )}
                            <AttendanceStrip days={s.attendance30d} />
                          </div>
                        </td>
                        <td className="px-3 py-2 tabular-nums" title={s.oldestPendingPeriod ? `Oldest: ${s.oldestPendingPeriod}` : ""}>
                          {(s.pendingFeesPaise ?? 0) === 0 ? (
                            <span className="text-emerald-300">✓ paid</span>
                          ) : (
                            <span className="text-rose-300">{rupees(s.pendingFeesPaise!)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-400">{fmtAgo(s.lastLogin)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2 text-xs">
                            <Link to={`/dashboard?as=${encodeURIComponent(s.username)}`} className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-brand-100 hover:bg-brand-500/20">📊 Perf</Link>
                            <Link to={`/history?as=${encodeURIComponent(s.username)}`} className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-2 py-1 text-brand-100 hover:bg-brand-500/20">📜 History</Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Non-management shell (student view) */}
      {!canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <h2 className="mb-2 font-display text-lg text-white">You're a {roleLabel.toLowerCase()} here</h2>
          <p className="text-sm text-ink-400">
            Head over to <Link to="/" className="text-brand-400 hover:underline">Puzzles</Link>,{" "}
            <Link to="/history" className="text-brand-400 hover:underline">History</Link>, or{" "}
            <Link to="/study" className="text-brand-400 hover:underline">Study</Link> to keep training.
          </p>
        </section>
      )}

      {/* ── Schedule a class (owner + coach) ── */}
      {canManage && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="font-display text-lg text-white">🎥 Schedule a class</h2>
            <span className="text-xs text-ink-500">Only academy members see it (join link is private).</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <input type="text" placeholder="Class title (e.g. Endgame drills)" value={classTitle}
              onChange={(e) => setClassTitle(e.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none md:col-span-2" />
            <input type="text" placeholder={`Coach name (default: ${me?.username || "you"})`} value={classCoach}
              onChange={(e) => setClassCoach(e.target.value)}
              className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <input type="datetime-local" value={classStartAt}
                onChange={(e) => setClassStartAt(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none" />
              <input type="number" min={5} max={600} value={classDur}
                onChange={(e) => setClassDur(Math.max(5, Math.min(600, Number(e.target.value) || 60)))}
                className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white focus:border-brand-500 focus:outline-none"
                title="Duration (minutes)" />
            </div>
            <div className="md:col-span-2 flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-ink-300 cursor-pointer">
                <input type="checkbox" checked={classAutoSummary} onChange={(e) => setClassAutoSummary(e.target.checked)}
                  className="rounded border-ink-600 bg-ink-800 text-brand-500 focus:ring-brand-500/40" />
                🤖 Auto-email a class summary 15 minutes after this class ends
                <span className="ml-1 text-ink-500">(you can still preview / send earlier manually)</span>
              </label>
              {lastAutoDefault && !classAutoSummary && (
                <button type="button"
                  onClick={() => { setClassAutoSummary(true); setClassAutoSummaryNote(lastAutoDefault.note); }}
                  className="ml-auto rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                  title={lastAutoDefault.note ? `Note: "${lastAutoDefault.note.slice(0, 60)}"` : "Use your last auto-summary settings"}>
                  ↺ Use last settings
                </button>
              )}
            </div>
            {classAutoSummary && (
              <div className="md:col-span-2">
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Note baked into the auto-send (optional)</label>
                <textarea value={classAutoSummaryNote} onChange={(e) => setClassAutoSummaryNote(e.target.value)}
                  rows={2} maxLength={500}
                  placeholder='e.g. "Practise today’s tactics 20 min tomorrow morning."'
                  className="w-full resize-none rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                <div className="mt-1 text-right text-[10px] text-ink-500 tabular-nums">{classAutoSummaryNote.length}/500</div>
              </div>
            )}
            <button disabled={!classTitle || scheduleMut.isPending} onClick={() => scheduleMut.mutate()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50 md:col-span-2">
              {scheduleMut.isPending ? "Scheduling…" : "Schedule class"}
            </button>
          </div>
          {scheduleMsg && <p className={`mt-2 text-xs ${scheduleMsg.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{scheduleMsg.text}</p>}
        </section>
      )}

      {/* ── Upcoming + live classes ── */}
      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <h2 className="mb-3 font-display text-lg text-white">
          📅 Classes
          <span className="ml-2 text-xs text-ink-500">
            {(schedule?.live?.length ?? 0)} live · {(schedule?.upcoming?.length ?? 0)} upcoming
          </span>
        </h2>
        {((schedule?.live?.length ?? 0) + (schedule?.upcoming?.length ?? 0)) === 0 && (
          <p className="text-sm text-ink-400">
            No scheduled classes yet. {canManage ? "Use the form above to schedule one." : "Your coach hasn't scheduled anything yet."}
          </p>
        )}
        {(schedule?.live?.length ?? 0) > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">🟢 Live now</div>
            {schedule!.live.map((c) => (
              <ClassRowUI key={c._id} c={c} live />
            ))}
          </div>
        )}
        {(schedule?.upcoming?.length ?? 0) > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Upcoming</div>
            {schedule!.upcoming.slice(0, 10).map((c) => (
              <ClassRowUI key={c._id} c={c} />
            ))}
          </div>
        )}
      </section>

      {/* ── Fees + billing (owner + coach; read-only for coach) ── */}
      {canManage && (
        <>
          {isOwner && (
            <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-display text-lg text-white">💰 Fees config</h2>
                <span className="text-xs text-ink-500">UPI-only for now (no Razorpay). Parents scan the QR to pay.</span>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">Monthly fee (₹)</label>
                  <input type="number" min="0" value={feeRupees} onChange={(e) => setFeeRupees(e.target.value)}
                    placeholder="e.g. 2500"
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">UPI VPA</label>
                  <input type="text" value={feeVpa} onChange={(e) => setFeeVpa(e.target.value.toLowerCase())}
                    placeholder="academy@ybl"
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-400">Payee name</label>
                  <input type="text" value={feePayeeName} onChange={(e) => setFeePayeeName(e.target.value)}
                    placeholder="Academy name shown in UPI app"
                    className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                </div>
                <button disabled={saveFeesMut.isPending} onClick={() => saveFeesMut.mutate()}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                  {saveFeesMut.isPending ? "Saving…" : "Save fees config"}
                </button>
                <button disabled={generateMut.isPending || !feesConfig?.monthlyFeePaise}
                  onClick={() => generateMut.mutate()}
                  className="rounded-lg border border-brand-500/50 bg-brand-500/10 px-4 py-2 text-sm font-semibold text-brand-100 hover:bg-brand-500/20 disabled:opacity-50">
                  {generateMut.isPending ? "Generating…" : "🧾 Generate this month's invoices"}
                </button>
              </div>
              {feesMsg && <p className={`mt-2 text-xs ${feesMsg.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{feesMsg.text}</p>}
            </section>
          )}

          <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="font-display text-lg text-white">💸 Pending invoices <span className="text-xs text-ink-500">({invoices?.length ?? 0})</span></h2>
              {(invoices?.length ?? 0) > 0 && feesConfig && (
                <span className="text-xs text-ink-500">Parents scan the QR to pay via UPI. You mark it paid after seeing the bank credit.</span>
              )}
              {(invoices?.length ?? 0) > 0 && (
                <button onClick={() => {
                  // CSV export -- coach hands to accountant / spouse / their
                  // own accounting tool. AmountINR is human, Paise kept for
                  // exact reconciliation with bank amounts.
                  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
                  const header = ["Generated", "Period", "Student", "AmountINR", "Paise", "Status"];
                  const lines = [header.map(esc).join(",")];
                  for (const inv of invoices!) {
                    lines.push([
                      new Date(inv.generatedAt).toISOString(),
                      inv.period,
                      inv.studentUsername,
                      (inv.amountPaise / 100).toFixed(2),
                      String(inv.amountPaise),
                      inv.status,
                    ].map((c) => esc(String(c))).join(","));
                  }
                  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `invoices-pending-${new Date().toISOString().slice(0, 10)}.csv`;
                  document.body.appendChild(a); a.click(); a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                  title="Download pending invoices as CSV"
                  className="ml-auto rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-ink-100">
                  ⬇ CSV <span className="ml-1 opacity-70">{invoices!.length}</span>
                </button>
              )}
            </div>
            {(invoices?.length ?? 0) === 0 && <p className="text-sm text-ink-400">No pending invoices.</p>}
            {(invoices?.length ?? 0) > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {invoices!.map((inv) => (
                  <InvoiceCard key={inv._id} inv={inv} config={feesConfig} isOwner={!!isOwner}
                    onMarkPaid={() => markPaidMut.mutate(inv._id)}
                    markPaidPending={markPaidMut.isPending}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Recent recordings (owner + coach) ── */}
      {canManage && recordings && recordings.length > 0 && (
        <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="font-display text-lg text-white">🎬 Recent recordings <span className="text-xs text-ink-500">({recordings.length})</span></h2>
            <button onClick={() => {
              // CSV export of every recording — same idea as the snap CSV
              // export. Openable columns first (title/date/size/duration),
              // then the play URL + raw download URL so the row round-trips.
              const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
              const header = ["At", "Class", "Filename", "SizeMB", "PlayUrl", "DownloadUrl"];
              const lines = [header.map(esc).join(",")];
              for (const r of recordings) {
                lines.push([
                  new Date(r.createdAt).toISOString(),
                  r.title || r.classId,
                  r.filename,
                  (r.bytes / (1024 * 1024)).toFixed(1),
                  `${location.origin}/class/${encodeURIComponent(r.classId)}/replay/${encodeURIComponent(r.filename)}`,
                  `${location.origin}/v2api/api/class/${encodeURIComponent(r.classId)}/recording/${encodeURIComponent(r.filename)}`,
                ].map((c) => esc(String(c))).join(","));
              }
              const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `recordings-${new Date().toISOString().slice(0, 10)}.csv`;
              document.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
              title="Download the recording list as a CSV"
              className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-ink-100">
              ⬇ CSV <span className="ml-1 opacity-70">{recordings.length}</span>
            </button>
          </div>
          <div className="grid gap-2">
            {recordings.slice(0, 20).map((r) => (
              <div key={`${r.classId}/${r.filename}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="text-white truncate">{r.title}</div>
                  <div className="text-[11px] text-ink-400">
                    {new Date(r.createdAt).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" · "}{(r.bytes / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
                <Link to={`/class/${encodeURIComponent(r.classId)}/replay/${encodeURIComponent(r.filename)}`}
                  className="rounded-lg bg-brand-600 hover:bg-brand-500 text-white px-3 py-1 text-xs font-semibold">
                  ▶ Play
                </Link>
                <a href={`/v2api/api/class/${encodeURIComponent(r.classId)}/recording/${encodeURIComponent(r.filename)}`}
                  download
                  className="rounded-lg border border-ink-700 hover:bg-ink-800 text-ink-300 px-3 py-1 text-xs">
                  ⬇ Download
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent snaps (owner + coach) — coach-flagged mid-class positions ── */}
      {canManage && snaps && snaps.length > 0 && <RecentSnapsSection snaps={snaps} />}

      <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
        <h2 className="mb-1 font-display text-lg text-white">🚀 Q1 shipping list</h2>
        <ul className="grid gap-2 text-sm text-ink-200 md:grid-cols-2">
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Multi-tenant signup</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Coach invitations</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Student enrollment (coach rosters)</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Owner/coach view student performance</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Attendance rollup per student</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Per-academy class scheduling</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">✅ Fees + UPI QR payments</li>
          <li className="rounded-lg border border-ink-700 bg-ink-800/40 px-3 py-2">🚀 Q1 complete — Q2 next</li>
        </ul>
      </section>
    </div>
  );
}

// Invoice card with an inline UPI QR the parent scans. QR is generated
// client-side (no external service). If UPI VPA isn't configured, we say so
// so the owner knows to fill it in on the Fees config panel above.
function InvoiceCard({ inv, config, isOwner, onMarkPaid, markPaidPending }: {
  inv: Invoice; config?: FeesConfig; isOwner: boolean;
  onMarkPaid: () => void; markPaidPending: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpa = config?.upiVpa || "";
  const payee = config?.upiPayeeName || "";
  const upiUrl = vpa ? upiIntent({
    vpa, name: payee || "Academy",
    amountPaise: inv.amountPaise,
    note: `Fees ${inv.period} · ${inv.studentUsername}`,
  }) : "";
  useEffect(() => {
    if (!upiUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, upiUrl, { width: 160, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
      .catch(() => {});
  }, [upiUrl]);

  return (
    <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-white">{inv.studentUsername}</span>
        <span className="text-xs text-ink-500">· {inv.period}</span>
        <span className="ml-auto text-lg font-bold tabular-nums text-rose-200">{rupees(inv.amountPaise)}</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {upiUrl ? (
          <>
            <canvas ref={canvasRef} width={160} height={160} className="rounded bg-white" />
            <div className="flex-1 text-xs text-ink-300">
              <div className="mb-1">Scan with any UPI app.</div>
              <div className="text-[10px] text-ink-500 break-all">to: <b className="text-ink-300">{vpa}</b></div>
              <a href={upiUrl} className="mt-2 inline-block text-brand-300 underline">Open in UPI app ↗</a>
            </div>
          </>
        ) : (
          <div className="text-xs text-amber-200">Set your UPI VPA in Fees config to render a QR here.</div>
        )}
      </div>
      {isOwner && (
        <div className="mt-2 flex justify-end gap-2">
          <button onClick={onMarkPaid} disabled={markPaidPending}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {markPaidPending ? "…" : "✓ Mark paid"}
          </button>
        </div>
      )}
    </div>
  );
}

// At-a-glance "today" ribbon — 4 tiles derived from data already loaded
// elsewhere on the page (no extra fetches). Filtering is by local calendar
// day so an owner in Chennai sees "today" the way they'd say it verbally.
type ScheduleForTodayStrip = { live?: ClassRow[]; upcoming?: ClassRow[] } | undefined;
function TodayStrip({ schedule, snaps, recordings }: {
  schedule: ScheduleForTodayStrip;
  snaps: SnapItem[] | undefined;
  recordings: Array<{ startAt: string; createdAt: string }> | undefined;
}) {
  const today = new Date();
  const sameDay = (d: Date) => d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  const liveNow = schedule?.live?.length ?? 0;
  const upcomingToday = (schedule?.upcoming ?? []).filter((c) => sameDay(new Date(c.startAt))).length;
  const classesToday = liveNow + upcomingToday;
  const snapsToday = (snaps ?? []).filter((s) => sameDay(new Date(s.at))).length;
  const recordingsToday = (recordings ?? []).filter((r) => sameDay(new Date(r.createdAt || r.startAt))).length;
  // Starred snaps -- all-time across every class. Tiny "current shortlist"
  // signal; small enough not to distract when zero.
  const starredTotal = (snaps ?? []).reduce((n, s) => n + (s.starred ? 1 : 0), 0);
  const reviewedTotal = (snaps ?? []).reduce((n, s) => n + (s.reviewedAt ? 1 : 0), 0);
  const toReview = (snaps ?? []).reduce((n, s) => n + ((s.starred && !s.reviewedAt) ? 1 : 0), 0);
  const Tile = ({ label, value, tone }: { label: string; value: number | string; tone: string }) => (
    <div className={`rounded-xl2 border ${tone} p-3 text-center`}>
      <div className="text-2xl font-semibold text-white tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
      <Tile label="Classes today" value={classesToday} tone="border-ink-700 bg-ink-900" />
      <Tile label="Live now" value={liveNow} tone={liveNow > 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-900"} />
      {(() => {
        // Deep-link to the volume-chart bar's week filter (Sunday-anchored)
        // for the current week. Closest we can get to "just today" without
        // introducing a day-scoped filter that only the ribbon would use.
        const sun = new Date();
        sun.setDate(sun.getDate() - sun.getDay());
        sun.setHours(0, 0, 0, 0);
        return (
          <Link to={`/academy?week=${encodeURIComponent(sun.toISOString())}`} title="Open the snap grid filtered to this week's snaps">
            <Tile label="Snaps today" value={snapsToday} tone={snapsToday > 0 ? "border-ink-700 bg-ink-900 hover:bg-ink-800" : "border-ink-700 bg-ink-900"} />
          </Link>
        );
      })()}
      <Tile label="Recordings today" value={recordingsToday} tone="border-ink-700 bg-ink-900" />
      <Link to="/academy?starred=1" title="Open the snap grid filtered to every starred snap">
        <Tile label="★ Starred (all)" value={starredTotal} tone={starredTotal > 0 ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10" : "border-ink-700 bg-ink-900"} />
      </Link>
      <Tile label="✓ Reviewed (all)" value={reviewedTotal} tone={reviewedTotal > 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-900"} />
      <Link to="/academy?starred=1&hidedone=1&sort=stale" title="Open the snap grid filtered to your review shortlist (starred + not done, most-stale first)">
        <Tile label="🎯 To review" value={toReview} tone={toReview > 0 ? "border-brand-500/40 bg-brand-500/5 hover:bg-brand-500/10" : "border-ink-700 bg-ink-900"} />
      </Link>
      <SnapSharesTile Tile={Tile} />
    </div>
  );
}

// Coach's outbound snap-share count. Fetched lazily so the today ribbon
// doesn't block on a network round-trip; renders as a neutral tile until
// data arrives. Only counts THIS week for the primary value; total in
// tooltip so the coach sees momentum.
function SnapSharesTile({ Tile }: { Tile: React.ComponentType<{ label: string; value: number | string; tone: string }> }) {
  const { data } = useQuery({
    queryKey: ["academy-snap-share-stats"],
    queryFn: () => get<{ total: number; thisWeek: number }>("/api/academy/snap-shares/stats"),
    staleTime: 60_000,
  });
  const week = data?.thisWeek ?? 0;
  const total = data?.total ?? 0;
  return (
    <div title={`Total snap-shares ever: ${total}`}>
      <Tile label="📤 Shares this week" value={week} tone={week > 0 ? "border-violet-500/40 bg-violet-500/5" : "border-ink-700 bg-ink-900"} />
    </div>
  );
}

// 30-day heatmap of the coach's own reviewedAt timestamps. Compact strip
// of 30 cells, emerald when they marked >=1 snap reviewed that day.
// Hover any cell for the exact date + count. Auto-hides when the coach
// has zero total reviews so a brand-new user doesn't see an empty ribbon.
function ReviewHeatmapStrip({ snaps }: { snaps?: SnapItem[] }) {
  const totals = (snaps ?? []).filter((s) => s.reviewedAt);
  if (totals.length === 0) return null;
  // Build day-buckets: index 0 = 29 days ago, 29 = today. Bucketed in local
  // time so the coach's "today" matches midnight-to-midnight for them.
  const today = new Date();
  const startOfDay = (d: Date) => {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const todayStart = startOfDay(today);
  const buckets: { d: Date; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - i);
    buckets.push({ d, count: 0 });
  }
  for (const s of totals) {
    const dt = new Date(s.reviewedAt!);
    const days = Math.floor((todayStart.getTime() - startOfDay(dt).getTime()) / 86_400_000);
    if (days < 0 || days > 29) continue;
    const bucket = buckets[29 - days];
    if (bucket) bucket.count++;
  }
  const totalCount = buckets.reduce((n, b) => n + b.count, 0);
  const daysActive = buckets.reduce((n, b) => n + (b.count > 0 ? 1 : 0), 0);
  // Streak = consecutive days ending today with >=1 review. Longest = max
  // consecutive run in the 30d window. Both derived from the buckets.
  let currentStreak = 0;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if ((buckets[i]?.count ?? 0) > 0) currentStreak++;
    else break;
  }
  let longest = 0, run = 0;
  for (const b of buckets) {
    if (b.count > 0) { run++; if (run > longest) longest = run; }
    else run = 0;
  }
  // At-risk = today has 0 reviews AND yesterday had >=1 (and so on). Coach
  // sees a small warning to review 1 snap and preserve the streak.
  const todayBucket = buckets[buckets.length - 1];
  const yesterdayBucket = buckets[buckets.length - 2];
  const streakAtRisk = (todayBucket?.count ?? 0) === 0 && (yesterdayBucket?.count ?? 0) > 0;
  let atRiskLen = 0;
  if (streakAtRisk) {
    for (let i = buckets.length - 2; i >= 0; i--) {
      if ((buckets[i]?.count ?? 0) > 0) atRiskLen++;
      else break;
    }
  }
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 px-4 py-3 flex items-center gap-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-400 shrink-0">
        30d review
        <div className="mt-0.5 text-[10px] normal-case tracking-normal text-ink-500 tabular-nums">
          {totalCount} snap{totalCount === 1 ? "" : "s"} · {daysActive} day{daysActive === 1 ? "" : "s"}
          {currentStreak > 0 && <> · <span className="text-emerald-300">🔥 {currentStreak}d streak</span></>}
          {streakAtRisk && atRiskLen >= 2 && (
            <> · <span className="text-amber-300" title={`Review at least one snap today to keep the ${atRiskLen}-day streak going`}>⚠ {atRiskLen}d streak at risk</span></>
          )}
          {longest > currentStreak && <> · best {longest}d</>}
        </div>
      </div>
      <div className="flex gap-0.5 flex-wrap" title="Days you marked snaps reviewed">
        {buckets.map((b, i) => {
          const tone = b.count === 0
            ? "bg-ink-800"
            : b.count === 1
              ? "bg-emerald-500/30"
              : b.count <= 3
                ? "bg-emerald-500/60"
                : "bg-emerald-400";
          return (
            <div key={i}
              className={`h-4 w-[10px] rounded-sm ${tone}`}
              title={`${b.d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} · ${b.count} reviewed`} />
          );
        })}
      </div>
    </div>
  );
}

// 12-week snap-volume bar chart. Each bar = one calendar week (Sun start),
// height scaled to the count of snaps taken that week. Coach sees "am I
// still doing this consistently?" without opening the digest. Hidden when
// the coach has fewer than 3 snaps total (nothing meaningful to trend).
function SnapVolumeChart({ snaps }: { snaps?: SnapItem[] }) {
  const all = snaps ?? [];
  if (all.length < 3) return null;
  const WEEKS = 12;
  const now = new Date();
  const startOfWeek = (d: Date) => {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    c.setDate(c.getDate() - c.getDay()); // Sunday = 0
    return c;
  };
  const thisSunday = startOfWeek(now);
  const buckets: { start: Date; count: number; classes: Map<string, { title: string; n: number }> }[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = new Date(thisSunday);
    start.setDate(start.getDate() - i * 7);
    buckets.push({ start, count: 0, classes: new Map() });
  }
  for (const s of all) {
    const d = startOfWeek(new Date(s.at));
    const weeksBack = Math.round((thisSunday.getTime() - d.getTime()) / (7 * 86_400_000));
    if (weeksBack < 0 || weeksBack >= WEEKS) continue;
    const bucket = buckets[WEEKS - 1 - weeksBack];
    if (!bucket) continue;
    bucket.count++;
    const cur = bucket.classes.get(s.classId);
    if (cur) cur.n++;
    else bucket.classes.set(s.classId, { title: s.classTitle, n: 1 });
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const totalRecent = buckets.reduce((n, b) => n + b.count, 0);
  // Top-3 classes by snap volume across the 12-week window. Small chips
  // beside the chart give "which class is filling the graph?" signal
  // without opening the snap grid. Click any chip → jump to the snap
  // grid filtered to that class.
  const classTally = new Map<string, { title: string; n: number }>();
  const cutoff = buckets[0]?.start ?? new Date(0);
  for (const s of all) {
    if (new Date(s.at) < cutoff) continue;
    const cur = classTally.get(s.classId);
    if (cur) cur.n++;
    else classTally.set(s.classId, { title: s.classTitle, n: 1 });
  }
  const topClasses = [...classTally.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3);
  return (
    <div className="rounded-xl2 border border-ink-700 bg-ink-900 px-4 py-3 flex items-center gap-4 flex-wrap">
      <div className="text-[11px] uppercase tracking-wide text-ink-400 shrink-0">
        12wk snaps
        <div className="mt-0.5 text-[10px] normal-case tracking-normal text-ink-500 tabular-nums">
          {totalRecent} total · peak {max}
        </div>
      </div>
      <div className="flex items-end gap-1 h-8 flex-1 min-w-[160px]" title="Snaps per week — click to filter the grid to that week">
        {buckets.map((b, i) => {
          const h = b.count === 0 ? 2 : Math.round(4 + (b.count / max) * 28);
          const topWeekClasses = [...b.classes.values()].sort((a, c) => c.n - a.n).slice(0, 2);
          const classHint = topWeekClasses.length > 0
            ? "\n" + topWeekClasses.map((c) => `${c.title}: ${c.n}`).join("\n")
            : "";
          const label = `${b.start.toLocaleDateString(undefined, { day: "2-digit", month: "short" })} · ${b.count} snap${b.count === 1 ? "" : "s"}${classHint}${b.count > 0 ? "\nclick to filter" : ""}`;
          const onClick = () => {
            if (b.count === 0) return;
            window.dispatchEvent(new CustomEvent(SNAP_WEEK_EVENT, { detail: { iso: b.start.toISOString() } }));
          };
          return (
            <button key={i} onClick={onClick} disabled={b.count === 0}
              className={`flex-1 rounded-sm ${b.count === 0 ? "bg-ink-800 cursor-default" : "bg-brand-500/70 hover:bg-brand-400 cursor-pointer"}`}
              style={{ height: `${h}px` }}
              title={label} />
          );
        })}
      </div>
      {topClasses.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {topClasses.map(([id, meta]) => (
            <Link key={id} to={`/academy?class=${encodeURIComponent(id)}`}
              title={`${meta.n} snap${meta.n === 1 ? "" : "s"} from this class in the last 12 weeks`}
              className="rounded-full border border-ink-700 bg-ink-800/60 px-2 py-0.5 text-[10px] font-semibold text-ink-200 hover:bg-ink-800 hover:text-white">
              <span className="max-w-[14ch] inline-block truncate align-bottom">{meta.title}</span>
              <span className="ml-1 opacity-70">{meta.n}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// The 3 oldest starred-but-not-yet-reviewed snaps -- surfaced under the
// today ribbon so the coach's next prep action is one click away. Only
// renders when there's at least one candidate; empty state stays hidden
// so a coach with no shortlist doesn't see a nag strip.
function NextUpToReview({ snaps }: { snaps?: SnapItem[] }) {
  const shortlist = (snaps ?? [])
    .filter((s) => !!s.starred && !s.reviewedAt)
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 3);
  if (shortlist.length === 0) return null;
  return (
    <div className="rounded-xl2 border border-brand-500/30 bg-brand-500/5 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-brand-300">🎯 Next up to review ({shortlist.length})</div>
      <div className="grid gap-2 md:grid-cols-3">
        {shortlist.map((s) => (
          <Link key={s._id} to={`/academy?snap=${encodeURIComponent(s._id)}`}
            className="flex gap-2 items-center rounded-lg border border-ink-700 bg-ink-800/60 p-2 hover:border-brand-500/50 hover:bg-ink-800 transition-colors">
            <div className="w-12 h-12 shrink-0">
              <Board fen={s.fen} viewOnly coordinates={false} className="mini" shapes={(s.shapes ?? []) as any} />
            </div>
            <div className="flex-1 min-w-0 text-[11px]">
              <div className="text-white truncate">{s.note || <span className="italic text-ink-500">(no note)</span>}</div>
              <div className="text-ink-500 truncate">{s.classTitle} · {new Date(s.at).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Individual snap card with inline note-edit. Only the original snap author
// can edit (server enforces via PATCH /api/class/:id/snap/:snapId). Card is
// a Link by default; edit mode swaps in a textarea + save/cancel so the
// coach can fix a typo without re-opening the board.
// Copies the current window URL to the clipboard. The snap-deep-link effect
// keeps ?snap=<id> synced to the URL while a modal is open, so pasting the
// clipboard drops the recipient into the same modal state.
function ShareLinkButton() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", window.location.href);
    }
  }
  return (
    <button onClick={copy}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${copied
        ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
        : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}
      title="Copy a link that opens this exact snap for a colleague">
      {copied ? "✓ Copied" : "🔗 Copy link"}
    </button>
  );
}

// Wraps matches of `query` (case-insensitive) in <mark> so they visually
// pop when the coach is text-searching. No regex escaping needed for the
// split call since we lowercase both sides and only use the length to slice.
function markText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!lower.includes(q)) return text;
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const found = lower.indexOf(q, i);
    if (found === -1) { out.push(text.slice(i)); break; }
    if (found > i) out.push(text.slice(i, found));
    out.push(<mark key={found} className="rounded bg-amber-300/30 text-amber-100 px-0.5">{text.slice(found, found + q.length)}</mark>);
    i = found + q.length;
  }
  return <>{out}</>;
}
function SnapCard({ s, isOpen, onOpen, onClose, onNav, neighbours, pos, selectMode, isSelected, onToggleSelect, query, slideshow, onSlideshowToggle, slideshowSec, onSlideshowSec }: {
  s: SnapItem;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onNav: (delta: 1 | -1) => void;
  neighbours?: { prev?: SnapItem; next?: SnapItem };
  pos?: { i: number; n: number };
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  query?: string;
  slideshow?: boolean;
  onSlideshowToggle?: () => void;
  slideshowSec?: number;
  onSlideshowSec?: (n: number) => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const canEdit = !!me?.userId && s.byUserId === me.userId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.note || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shapes = Array.isArray(s.shapes) ? s.shapes : [];
  const href = shapes.length > 0
    ? `/board-editor?fen=${encodeURIComponent(s.fen)}&shapes=${encodeShapesForUrl(shapes)}`
    : `/board-editor?fen=${encodeURIComponent(s.fen)}`;
  async function saveNote() {
    if (saving) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: draft }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`); return; }
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["academy-snaps"] });
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setSaving(false); }
  }
  // Share flow -- author-only. Small in-modal panel to pick a student and
  // add an optional note; POSTs /academy/snap-share.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTo, setShareTo] = useState<string>("");
  const [shareMsg, setShareMsg] = useState("");
  const [shareSending, setShareSending] = useState(false);
  const [shareResult, setShareResult] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => { setShareOpen(false); setShareResult(null); setShareMsg(""); setShareTo(""); }, [s._id, isOpen]);
  const shareStudentsQ = useQuery({
    queryKey: ["academy-students"],
    queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: shareOpen,
  });
  async function sendShare() {
    if (!shareTo || shareSending) return;
    setShareSending(true); setShareResult(null);
    try {
      const r = await fetch(`${BASE}/api/academy/snap-share`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapId: s._id, studentId: shareTo, message: shareMsg }),
      }).then((res) => res.json());
      if (r?.ok) setShareResult({ ok: true, msg: `Sent to ${r.to || "student"}` });
      else setShareResult({ ok: false, msg: r?.error || "Send failed" });
    } catch { setShareResult({ ok: false, msg: "Network error" }); }
    finally { setShareSending(false); }
  }
  async function toggleReviewed() {
    try {
      const r = await fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewed: !s.reviewedAt }),
      });
      if (!r.ok) return;
      qc.invalidateQueries({ queryKey: ["academy-snaps"] });
    } catch { /* ignore */ }
  }
  async function toggleStar() {
    try {
      const r = await fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !s.starred }),
      });
      if (!r.ok) return;
      qc.invalidateQueries({ queryKey: ["academy-snaps"] });
    } catch { /* ignore */ }
  }
  async function deleteSnap() {
    if (!window.confirm(`Delete this snap${s.note ? ` — "${s.note.slice(0, 60)}"` : ""}? This can't be undone.`)) return;
    try {
      const r = await fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) { window.alert((await r.json().catch(() => ({}))).message || `Failed: HTTP ${r.status}`); return; }
      qc.invalidateQueries({ queryKey: ["academy-snaps"] });
    } catch (e) { window.alert(String((e as Error).message || e)); }
  }
  // Duration of the modal-loaded audio (populated via loadedmetadata).
  // Resets when a different snap becomes active so ← / → nav re-probes.
  const [audioDur, setAudioDur] = useState<number>(0);
  useEffect(() => { setAudioDur(0); }, [s._id, isOpen]);
  // Transcript editor state -- author-only. Resets on ← / → nav.
  const [transEditing, setTransEditing] = useState(false);
  const [transDraft, setTransDraft] = useState(s.transcript || "");
  const [transSaving, setTransSaving] = useState(false);
  useEffect(() => { setTransEditing(false); setTransDraft(s.transcript || ""); }, [s._id, isOpen]);
  async function saveTranscript() {
    if (transSaving) return;
    setTransSaving(true);
    try {
      const r = await fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transDraft }),
      });
      if (r.ok) { setTransEditing(false); qc.invalidateQueries({ queryKey: ["academy-snaps"] }); }
    } catch { /* silent */ }
    finally { setTransSaving(false); }
  }
  // Card click opens an inline detail modal (bigger board + audio + full note)
  // instead of navigating away. The modal itself is a portal-less <div> that
  // renders when isOpen is true. Modal state lives in the parent so ← / →
  // keys can walk across cards without prop-drilling through refs.
  const cardOnClick = (e: React.MouseEvent) => {
    if (editing) return;
    e.preventDefault(); e.stopPropagation();
    if (selectMode && onToggleSelect) { onToggleSelect(); return; }
    onOpen();
  };
  // ← / → walk the filtered snap list; Esc closes. Bail if the user is typing
  // in a text field so chat/URL bar still work.
  useEffect(() => {
    if (!isOpen) return;
    const isTextField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTextField(e.target)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onNav(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onNav(-1); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onNav, onClose]);
  return (
    <div onClick={cardOnClick} role={editing ? undefined : "button"} tabIndex={editing ? undefined : 0}
      onKeyDown={(e) => { if (!editing && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      className={`group flex gap-3 rounded-lg border p-3 transition-colors ${editing
        ? "border-brand-500/60 bg-ink-800"
        : selectMode && isSelected
          ? "border-brand-500 bg-brand-500/10 cursor-pointer ring-2 ring-brand-500/40"
          : "border-ink-700 bg-ink-800/40 hover:border-brand-500/50 hover:bg-ink-800/60 cursor-pointer"}`}>
      <div className="w-24 h-24 shrink-0">
        <Board fen={s.fen} viewOnly coordinates={false} className="mini" shapes={shapes as any} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col text-sm">
        <div className="text-white truncate">
          {canEdit ? (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleStar(); }}
              className={`mr-1 text-xs align-middle ${s.starred ? "text-amber-300" : "text-ink-600 hover:text-amber-300 opacity-0 group-hover:opacity-100"} transition-opacity`}
              title={s.starred ? "Un-star" : "Star for review shortlist"}>{s.starred ? "★" : "☆"}</button>
          ) : s.starred ? <span className="mr-1 text-xs text-amber-300 align-middle">★</span> : null}
          <b>{s.byName}</b>
          {shapes.length > 0 && <span className="ml-1 text-[10px] text-amber-300">✏️{shapes.length}</span>}
          {(() => { const sec = estimateAudioSeconds(s.audioBytes); return s.hasAudio && sec != null ? <span className="ml-1 text-[10px] text-violet-300" title="Approximate clip length">🎙~{sec}s</span> : null; })()}
          {s.reviewedAt && <span className="ml-1 text-[10px] text-emerald-300" title={`Reviewed ${new Date(s.reviewedAt).toLocaleDateString()}`}>✓</span>}
          {(() => {
            // Stale badge: starred + unreviewed + taken > 30 days ago. Nudges
            // the coach to either review or delete forgotten backlog items.
            if (!s.starred || s.reviewedAt) return null;
            const days = Math.floor((Date.now() - new Date(s.at).getTime()) / 86_400_000);
            if (days < 30) return null;
            return <span className="ml-1 text-[10px] text-rose-300"
              title={`Starred ${days} days ago but never reviewed — worth revisiting or clearing.`}>⏰{days}d</span>;
          })()}
          {canEdit && !editing && (
            <>
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDraft(s.note || ""); setEditing(true); }}
                className="ml-2 text-[10px] text-ink-500 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white"
                title="Edit note">✎ edit</button>
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteSnap(); }}
                className="ml-1 text-[10px] text-ink-500 opacity-0 group-hover:opacity-100 transition-opacity hover:text-rose-300"
                title="Delete snap">🗑</button>
            </>
          )}
        </div>
        <div className="text-[11px] text-ink-400 truncate">{s.classTitle}</div>
        <div className="mt-0.5 text-[10px] font-mono text-ink-500 truncate" title={s.fen}>{describeFen(s.fen)}</div>
        {editing ? (
          <div className="mt-1">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={500}
              onClick={(e) => e.stopPropagation()}
              className="w-full resize-none rounded border border-ink-600 bg-ink-900 px-2 py-1 text-[12px] text-white outline-none focus:border-brand-500" />
            {err && <div className="mt-1 text-[10px] text-rose-300">{err}</div>}
            <div className="mt-1 flex items-center gap-2">
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); saveNote(); }} disabled={saving}
                className="rounded bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(false); setErr(null); }}
                className="rounded border border-ink-600 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800">Cancel</button>
              <span className="ml-auto text-[10px] text-ink-500 tabular-nums">{draft.length}/500</span>
            </div>
          </div>
        ) : (
          s.note && <div className="mt-1 text-[12px] text-ink-300 line-clamp-2">"{markText(s.note, query || "")}"</div>
        )}
        {s.hasAudio && !editing && (
          <audio controls preload="none"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            src={`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}/audio`}
            className="mt-1 h-6 w-full" />
        )}
        <div className="mt-auto text-[10px] text-ink-500">
          {new Date(s.at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
          {!editing && <span className="ml-2 text-brand-300 opacity-0 group-hover:opacity-100 transition-opacity">🔍 Expand</span>}
        </div>
      </div>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-xl2 border border-ink-700 bg-ink-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display text-lg text-white truncate">
                  {s.starred && <span className="mr-1 text-amber-300">★</span>}
                  {s.byName}
                </div>
                <div className="text-[11px] text-ink-400 truncate">{s.classTitle} · {new Date(s.at).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-ink-500 shrink-0">
                {pos && (
                  <span className="rounded-full border border-ink-700 bg-ink-800 px-2 py-0.5 tabular-nums text-ink-300">
                    {pos.i + 1} / {pos.n}
                  </span>
                )}
                {onSlideshowToggle && (
                  <button onClick={onSlideshowToggle}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${slideshow
                      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
                      : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800"}`}
                    title={`Auto-advance every ${slideshowSec ?? 6}s through all snaps in view`}>
                    {slideshow ? "⏸ Pause" : "▶ Play"}
                  </button>
                )}
                {slideshow && onSlideshowSec && (
                  <div className="flex items-center gap-0.5">
                    {[3, 6, 12].map((s) => (
                      <button key={s} onClick={() => onSlideshowSec(s)}
                        className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${slideshowSec === s
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
                          : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>{s}s</button>
                    ))}
                  </div>
                )}
                <ShareLinkButton />
                <span className="hidden sm:inline text-ink-500"
                  title="← / →  prev/next snap · Esc  close · Ctrl/⌘-click card to select without opening">
                  ← → · Esc
                </span>
                <button onClick={() => onClose()}
                  className="text-ink-400 hover:text-white text-sm">Esc</button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
              <div className="w-full">
                <Board fen={s.fen} viewOnly shapes={shapes as any} />
              </div>
              <div className="min-w-0 flex flex-col gap-3 text-sm">
                <div className="text-[10px] font-mono text-ink-500 break-all" title="FEN">{s.fen}</div>
                <div className="text-[11px] text-ink-500">{describeFen(s.fen)}</div>
                {s.note && <div className="rounded border border-ink-700 bg-ink-800/40 p-2 text-ink-200 whitespace-pre-wrap">"{markText(s.note, query || "")}"</div>}
                {s.hasAudio && (
                  <div>
                    <audio controls preload="metadata"
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration;
                        if (Number.isFinite(d) && d > 0) setAudioDur(d);
                      }}
                      src={`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}/audio`}
                      className="w-full" />
                    {audioDur > 0 && (
                      <div className="mt-0.5 text-[10px] text-ink-500 tabular-nums">🎙 {audioDur.toFixed(1)}s clip</div>
                    )}
                  </div>
                )}
                {shapes.length > 0 && <div className="text-[11px] text-amber-300">✏️ {shapes.length} arrow{shapes.length === 1 ? "" : "s"} preserved</div>}
                {(s.transcript || (canEdit && transEditing)) && (
                  <details className="text-[12px] text-ink-300" open={transEditing}>
                    <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-violet-300 hover:text-violet-100">
                      📝 Transcript (auto)
                      {canEdit && !transEditing && (
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTransEditing(true); }}
                          className="ml-2 text-ink-500 hover:text-white normal-case tracking-normal">✎ edit</button>
                      )}
                    </summary>
                    {transEditing ? (
                      <div className="mt-1">
                        <textarea value={transDraft} onChange={(e) => setTransDraft(e.target.value)} rows={4} maxLength={2000}
                          className="w-full resize-none rounded border border-ink-600 bg-ink-900 px-2 py-1 text-[12px] text-white outline-none focus:border-brand-500" />
                        <div className="mt-1 flex items-center gap-2">
                          <button onClick={saveTranscript} disabled={transSaving}
                            className="rounded bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                            {transSaving ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => { setTransEditing(false); setTransDraft(s.transcript || ""); }}
                            className="rounded border border-ink-600 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-800">Cancel</button>
                          <span className="ml-auto text-[10px] text-ink-500 tabular-nums">{transDraft.length}/2000</span>
                        </div>
                      </div>
                    ) : s.transcript ? (
                      <div className="mt-1 rounded border border-ink-700 bg-ink-800/40 p-2 italic whitespace-pre-wrap">{markText(s.transcript, query || "")}</div>
                    ) : null}
                  </details>
                )}
                {/* Preload neighbour audio while the modal is open so ← / → to
                    an audio snap starts playing without a fetch hitch. Hidden
                    element, no controls, purely a network warmup. */}
                {neighbours?.prev?.hasAudio && (
                  <audio preload="auto" style={{ display: "none" }}
                    src={`${BASE}/api/class/${encodeURIComponent(neighbours.prev.classId)}/snap/${encodeURIComponent(neighbours.prev._id)}/audio`} />
                )}
                {neighbours?.next?.hasAudio && (
                  <audio preload="auto" style={{ display: "none" }}
                    src={`${BASE}/api/class/${encodeURIComponent(neighbours.next.classId)}/snap/${encodeURIComponent(neighbours.next._id)}/audio`} />
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Link to={href} onClick={() => onClose()}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">
                    🔬 Open in board editor
                  </Link>
                  {canEdit && (
                    <>
                      <button onClick={() => { setDraft(s.note || ""); setEditing(true); onClose(); }}
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">✎ Edit note</button>
                      <button onClick={() => { toggleStar(); }}
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800">{s.starred ? "★ Un-star" : "☆ Star"}</button>
                      <button onClick={() => { toggleReviewed(); }}
                        className={`rounded-lg border px-3 py-1.5 text-sm ${s.reviewedAt
                          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                          : "border-ink-600 text-ink-200 hover:bg-ink-800"}`}>
                        {s.reviewedAt ? "✓ Reviewed" : "☐ Mark reviewed"}
                      </button>
                      <button onClick={() => setShareOpen((v) => !v)}
                        className={`rounded-lg border px-3 py-1.5 text-sm ${shareOpen
                          ? "border-brand-500/60 bg-brand-500/10 text-brand-100"
                          : "border-ink-600 text-ink-200 hover:bg-ink-800"}`}>
                        📤 Send to student
                      </button>
                    </>
                  )}
                </div>
                {shareOpen && (
                  <div className="mt-3 rounded-lg border border-brand-500/40 bg-brand-500/5 p-3 space-y-2">
                    <label className="block text-[11px] uppercase tracking-wide text-ink-400">Pick a student</label>
                    <select value={shareTo} onChange={(e) => setShareTo(e.target.value)}
                      className="w-full rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-brand-500">
                      <option value="">— Select a student —</option>
                      {(shareStudentsQ.data ?? []).map((st) => (
                        <option key={st._id} value={st._id}>
                          {st.username}{st.email ? ` · ${st.email}` : " · (no email)"}
                        </option>
                      ))}
                    </select>
                    <label className="block text-[11px] uppercase tracking-wide text-ink-400">Optional note</label>
                    <textarea value={shareMsg} onChange={(e) => setShareMsg(e.target.value)} rows={2} maxLength={500}
                      placeholder='e.g. "Try to find the winning tactic before checking the analysis."'
                      className="w-full resize-none rounded-lg border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-white placeholder:text-ink-500 outline-none focus:border-brand-500" />
                    <div className="flex items-center gap-2">
                      <button onClick={sendShare} disabled={!shareTo || shareSending}
                        className="rounded-lg bg-brand-600 px-3 py-1 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                        {shareSending ? "Sending…" : "Send email"}
                      </button>
                      {shareResult && (
                        <span className={`text-[11px] ${shareResult.ok ? "text-emerald-300" : "text-rose-300"}`}>
                          {shareResult.ok ? "✓ " : "⚠️ "}{shareResult.msg}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Small link on the dashboard header that opens a preview of the coach's
// upcoming Sunday-morning starred-snap digest email. Modal shows the raw
// shortlist so the coach can eyeball what the digest will contain.
function StarredDigestPreviewLink() {
  const [open, setOpen] = useState(false);
  type Row = { _id: string; classId: string; at: string; note: string; hasAudio: boolean; shapeCount: number; link: string };
  type HistoryRow = { sentAt: string; snapCount: number; windowDays: number };
  type PreviewData = { snapCount: number; snaps: Row[]; cadence: "weekly" | "biweekly" | "monthly"; windowDays: number; optedOut: boolean; sentCount: number; lastSentAt: string | null; reviewedSinceLast: number; pendingBacklog: number; stuck: boolean; staleCount: number; busiestClass: { title: string; n: number } | null; streakDays: number; history: HistoryRow[] };
  const [data, setData] = useState<PreviewData | null>(null);
  // Ambient stats fetched on mount so the link line shows current cadence +
  // last-sent + backlog before the coach opens the modal. Same endpoint.
  const [stats, setStats] = useState<{ cadence: string; sentCount: number; lastSentAt: string | null; pendingBacklog: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/academy/starred-digest/preview`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j && typeof j.snapCount === "number") setStats({ cadence: j.cadence, sentCount: j.sentCount, lastSentAt: j.lastSentAt, pendingBacklog: j.pendingBacklog }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [savingCadence, setSavingCadence] = useState(false);
  async function setCadence(c: "weekly" | "biweekly" | "monthly") {
    if (savingCadence || !data || data.cadence === c) return;
    setSavingCadence(true);
    try {
      await fetch(`${BASE}/api/academy/starred-digest/cadence`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: c }),
      });
      // Refetch preview so the window resizes to match the new cadence.
      const fresh = await fetch(`${BASE}/api/academy/starred-digest/preview`, { credentials: "include" }).then((r) => r.json());
      setData(fresh);
    } catch { /* silent */ }
    finally { setSavingCadence(false); }
  }
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  async function load() {
    setData(null); setSendMsg(null); setOpen(true);
    try {
      const r = await fetch(`${BASE}/api/academy/starred-digest/preview`, { credentials: "include" }).then((res) => res.json());
      setData(r);
    } catch { /* modal shows loading forever -- coach can close */ }
  }
  async function sendNow() {
    if (sending) return;
    setSending(true); setSendMsg(null);
    try {
      const r = await fetch(`${BASE}/api/academy/starred-digest/send-now`, { method: "POST", credentials: "include" }).then((res) => res.json());
      setSendMsg(r?.ok ? `✓ Sent — ${r.snapCount} snap${r.snapCount === 1 ? "" : "s"}` : `⚠️ ${r?.note || "Send failed"}`);
    } catch { setSendMsg("⚠️ Network error"); }
    finally { setSending(false); }
  }
  return (
    <div className="flex items-baseline flex-wrap gap-2">
      <button onClick={load}
        className="text-[11px] text-brand-300 hover:text-brand-100 underline">
        📧 Preview my Sunday digest
      </button>
      {stats && (
        <span className="text-[10px] text-ink-500">
          · cadence: <b className="text-ink-300">{stats.cadence}</b>
          {stats.sentCount > 0
            ? <> · <b className="text-ink-300">{stats.sentCount}</b> sent{stats.lastSentAt ? <> · last {fmtAgo(stats.lastSentAt)}</> : null}</>
            : <> · never sent yet</>}
          {stats.pendingBacklog > 0 && <> · <b className="text-brand-300">{stats.pendingBacklog}</b> queued</>}
        </span>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl2 border border-ink-700 bg-ink-900 p-5 shadow-2xl">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg text-white">📧 Sunday digest preview</h3>
              <button onClick={() => setOpen(false)} className="text-ink-400 hover:text-white text-sm">Esc</button>
            </div>
            {!data ? (
              <div className="text-sm text-ink-400">Loading…</div>
            ) : data.snapCount === 0 ? (
              <div className="text-sm text-ink-400">
                No starred snaps in the last 7 days. Star a few positions during class and this preview will populate.
              </div>
            ) : (
              <>
                <div className="mb-2 text-sm text-ink-200">
                  You'd receive <b>{data.snapCount}</b> starred position{data.snapCount === 1 ? "" : "s"} — covering the last <b>{data.windowDays}</b> days.
                </div>
                {data.busiestClass && (
                  <div className="mb-2 text-[11px] text-ink-400">
                    🏫 Most from <b className="text-ink-200">{data.busiestClass.title}</b> ({data.busiestClass.n} snap{data.busiestClass.n === 1 ? "" : "s"}).
                  </div>
                )}
                {data.reviewedSinceLast > 0 && (
                  <div className="mb-2 text-[11px] text-emerald-300">
                    ✓ You've reviewed {data.reviewedSinceLast} snap{data.reviewedSinceLast === 1 ? "" : "s"} since the last digest{data.lastSentAt ? "" : " (or in the last 30 days)"} — this'll be called out in the email.
                    {data.streakDays >= 3 && <span className="ml-1 text-orange-300">🔥 {data.streakDays}-day streak</span>}
                  </div>
                )}
                {data.stuck && (
                  <div className="mb-2 rounded border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                    💤 It's been a while — <b>{data.pendingBacklog}</b> starred position{data.pendingBacklog === 1 ? "" : "s"} still waiting for review. Sunday's email will include a friendly nudge line.
                  </div>
                )}
                {data.staleCount > 0 && (
                  <div className="mb-2 text-[11px] text-orange-300">
                    ⏰ <b>{data.staleCount}</b> starred position{data.staleCount === 1 ? "" : "s"} over 30 days old — the email calls these out too.
                  </div>
                )}
                {(() => {
                  // Cadence auto-suggest: nudge toward the cadence that fits
                  // the coach's actual snap volume. Too many per window = long
                  // email + delayed review; too few = wasted send.
                  const perDay = data.snapCount / Math.max(1, data.windowDays);
                  let suggest: "weekly" | "biweekly" | "monthly" | null = null;
                  if (perDay >= 2) suggest = "weekly";
                  else if (perDay < 0.15) suggest = "monthly";
                  if (!suggest || suggest === data.cadence) return null;
                  return (
                    <div className="mb-2 text-[11px] text-brand-300">
                      💡 At this rate ({data.snapCount} snap{data.snapCount === 1 ? "" : "s"} / {data.windowDays}d), you might prefer <b>{suggest}</b> cadence — click the pill below to switch.
                    </div>
                  );
                })()}
                <ol className="max-h-72 overflow-y-auto pr-1 space-y-1 text-sm">
                  {data.snaps.map((s, i) => (
                    <li key={s._id} className="flex items-baseline gap-2 rounded border border-ink-700 bg-ink-800/40 px-2 py-1.5">
                      <span className="tabular-nums text-[10px] text-ink-500 w-6 text-right">{i + 1}.</span>
                      <a href={s.link} target="_blank" rel="noreferrer" className="text-brand-300 hover:underline flex-1 truncate">
                        {s.note || <span className="italic text-ink-500">(no note)</span>}
                      </a>
                      {s.shapeCount > 0 && <span className="text-[10px] text-amber-300">✏️{s.shapeCount}</span>}
                      {s.hasAudio && <span className="text-[10px] text-violet-300">🎙</span>}
                      <span className="text-[10px] text-ink-500 tabular-nums">{new Date(s.at).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {data && (
              <div className="mt-4 flex items-center flex-wrap gap-2 border-t border-ink-800 pt-3">
                <span className="text-[11px] uppercase tracking-wide text-ink-500">Cadence</span>
                {(["weekly", "biweekly", "monthly"] as const).map((c) => (
                  <button key={c} onClick={() => setCadence(c)} disabled={savingCadence}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${data.cadence === c
                      ? "border-brand-500/60 bg-brand-500/15 text-brand-100"
                      : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>{c}</button>
                ))}
                {data.snapCount > 0 && (
                  <>
                    <span className="ml-auto" />
                    <button onClick={sendNow} disabled={sending}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                      {sending ? "Sending…" : "📧 Send it to me now"}
                    </button>
                    {sendMsg && <span className="text-[11px] text-ink-300">{sendMsg}</span>}
                  </>
                )}
              </div>
            )}
            {data && (
              <div className="mt-2 text-[10px] text-ink-500">
                {data.sentCount === 0
                  ? "No digests sent yet."
                  : `You've been sent ${data.sentCount} digest${data.sentCount === 1 ? "" : "s"}${data.lastSentAt ? ` · last on ${new Date(data.lastSentAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}` : ""}.`}
              </div>
            )}
            {data && data.history.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-ink-500 hover:text-ink-300">
                  📊 Recent digest history ({data.history.length})
                </summary>
                <ul className="mt-1 space-y-0.5 text-[11px]">
                  {data.history.map((h) => (
                    <li key={h.sentAt} className="flex items-baseline gap-2 rounded px-2 py-0.5 hover:bg-ink-800/60">
                      <span className="tabular-nums text-ink-400 w-24">
                        {new Date(h.sentAt).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}
                      </span>
                      <span className="tabular-nums text-ink-300">{h.snapCount} snap{h.snapCount === 1 ? "" : "s"}</span>
                      <span className="tabular-nums text-ink-500">· {h.windowDays}d window</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Snaps grouped-by-class with a chip filter above the grid. Chips read like
// "All (23) · Middlegame 6 · Endgame drill 4", auto-collapsed to the top 5
// classes so a busy academy doesn't get a 30-chip wrap. Click a chip to
// scope the grid; click All to reset. The 12-card visible limit still
// applies within the filtered view.
type SnapShape = { orig: string; dest?: string; brush?: string };
type SnapItem = { _id: string; classId: string; classTitle: string; fen: string; note: string; byName: string; byUserId?: string; at: string; shapes?: SnapShape[]; starred?: boolean; hasAudio?: boolean; audioBytes?: number; transcript?: string; reviewedAt?: string | null };
// Nominal opus bitrate MediaRecorder uses by default (~48 kbps). Cheap
// duration estimate for the card badge -- coach uses it to eyeball short
// vs long clips without opening each modal. Off by a couple seconds if a
// browser encoded at a different rate; that's fine at this granularity.
function estimateAudioSeconds(bytes?: number): number | null {
  if (!bytes || bytes < 500) return null;
  return Math.max(1, Math.round(bytes / 6000));
}
// URL-safe base64 encoder for the shapes deep-link. Matches decoder in BoardEditor.tsx.
function encodeShapesForUrl(shapes: SnapShape[]): string {
  return btoa(JSON.stringify(shapes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Quick position summary from a FEN — just enough to tell an endgame study
// from a middlegame at a glance without opening the board editor. No chess.js
// dependency; parses the piece-placement field with a regex.
function describeFen(fen: string): string {
  const piece = fen.split(" ")[0] ?? "";
  const w = { P: 0, N: 0, B: 0, R: 0, Q: 0 };
  const b = { P: 0, N: 0, B: 0, R: 0, Q: 0 };
  for (const ch of piece) {
    if (ch >= "A" && ch <= "Z" && ch in w) (w as Record<string, number>)[ch]!++;
    else if (ch >= "a" && ch <= "z") { const u = ch.toUpperCase(); if (u in b) (b as Record<string, number>)[u]!++; }
  }
  const totalW = w.P + w.N + w.B + w.R + w.Q;
  const totalB = b.P + b.N + b.B + b.R + b.Q;
  const total = totalW + totalB;
  const fmtSide = (s: typeof w) => {
    const parts: string[] = ["K"];
    (["Q", "R", "B", "N", "P"] as const).forEach((k) => { if (s[k] > 1) parts.push(`${s[k]}${k}`); else if (s[k] === 1) parts.push(k); });
    return parts.join("+");
  };
  const phase = total <= 6 ? "Endgame" : total >= 24 ? "Opening/Middlegame" : "Middlegame";
  return `${phase} · ${fmtSide(w)} vs ${fmtSide(b)}`;
}
// Small module-level bus so SnapVolumeChart (rendered ABOVE RecentSnapsSection
// in the tree) can push a week-filter down without prop-drilling through the
// whole layout. Chart dispatches a CustomEvent, section listens on window.
const SNAP_WEEK_EVENT = "cg-snap-week-filter";
function RecentSnapsSection({ snaps }: { snaps: SnapItem[] }) {
  // Filter state is URL-synced so a coach can share the exact view with a
  // colleague ("look at ?q=diagonal&starred=1"). Hydrate from URL on first
  // render, then push changes back with replace so we don't spam history.
  const [sp, setSp] = useSearchParams();
  const [classFilter, setClassFilter] = useState<string>(sp.get("class") || "");
  const [starredOnly, setStarredOnly] = useState<boolean>(sp.get("starred") === "1");
  const [textFilter, setTextFilter] = useState<string>(sp.get("q") || "");
  const [hideReviewed, setHideReviewed] = useState<boolean>(sp.get("hidedone") === "1");
  const [weekFilter, setWeekFilter] = useState<string>(sp.get("week") || "");
  // Global "/" hotkey focuses the search input -- Slack/GitHub convention.
  // Bail if the user is already typing in some input so mid-text "/" chars
  // (URLs, timestamps) aren't hijacked.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const tgt = e.target as HTMLElement | null;
      if (!tgt) return;
      const tag = tgt.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt.isContentEditable) return;
      const el = searchInputRef.current;
      if (!el) return;
      e.preventDefault();
      el.focus();
      el.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);   // ISO date of week-start (Sun)
  useEffect(() => {
    const handler = (e: Event) => {
      const iso = (e as CustomEvent<{ iso: string }>).detail?.iso;
      if (iso) setWeekFilter(iso);
    };
    window.addEventListener(SNAP_WEEK_EVENT, handler as EventListener);
    return () => window.removeEventListener(SNAP_WEEK_EVENT, handler as EventListener);
  }, []);
  type SortKey = "recent" | "oldest" | "arrows" | "stale";
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const v = sp.get("sort");
    return (v === "oldest" || v === "arrows" || v === "stale") ? (v as SortKey) : "recent";
  });
  useEffect(() => {
    // Rebuild the URL query from state. Empty values drop out so links stay clean.
    const next = new URLSearchParams(sp);
    if (classFilter) next.set("class", classFilter); else next.delete("class");
    if (starredOnly) next.set("starred", "1"); else next.delete("starred");
    if (textFilter) next.set("q", textFilter); else next.delete("q");
    if (hideReviewed) next.set("hidedone", "1"); else next.delete("hidedone");
    if (weekFilter) next.set("week", weekFilter); else next.delete("week");
    if (sortKey !== "recent") next.set("sort", sortKey); else next.delete("sort");
    setSp(next, { replace: true });
    // Only depend on the filters -- sp change is already how we write, so skip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classFilter, starredOnly, textFilter, hideReviewed, sortKey, weekFilter]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  // Slideshow: auto-advance every N seconds while a modal is open. Wired
  // below once shownIds is in scope so we can wrap at the actual count.
  // Interval persists in localStorage so a coach who likes slow pacing
  // (12s) keeps it across sessions.
  const [slideshow, setSlideshow] = useState(false);
  const [slideshowSec, setSlideshowSec] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("cg_slideshow_sec");
      const n = raw ? Number(raw) : 6;
      return n === 3 || n === 6 || n === 12 ? n : 6;
    } catch { return 6; }
  });
  useEffect(() => { try { localStorage.setItem("cg_slideshow_sec", String(slideshowSec)); } catch { /* */ } }, [slideshowSec]);
  // Reset the open snap when filters change so we don't end up pointing at a
  // row that just got filtered out.
  useEffect(() => { setOpenIdx(null); }, [classFilter, starredOnly, textFilter]);
  // Deep-link to a specific snap via ?snap=<id>. On mount (and when snaps
  // arrives from React Query) find the id in the shown-list and open its
  // modal. When the user opens/closes a snap via the UI we push the id back
  // to the URL so browser refresh preserves state.
  const wantSnapId = sp.get("snap");
  useEffect(() => {
    if (!wantSnapId || openIdx != null) return;
    // Best-effort: find in the (potentially filtered) 12-card slice.
    const idx = (classFilter || starredOnly || textFilter ? snaps
      .filter((s) => (classFilter ? s.classId === classFilter : true))
      .filter((s) => (starredOnly ? !!s.starred : true))
      .filter((s) => !textFilter || (String(s.note || "").toLowerCase().includes(textFilter.toLowerCase())
        || String(s.transcript || "").toLowerCase().includes(textFilter.toLowerCase())
        || String(s.classTitle || "").toLowerCase().includes(textFilter.toLowerCase()))) : snaps)
      .slice(0, 12).findIndex((s) => s._id === wantSnapId);
    if (idx >= 0) setOpenIdx(idx);
  }, [wantSnapId, snaps, classFilter, starredOnly, textFilter, openIdx]);
  // Push openIdx back to URL so a direct-share of the current view captures
  // the modal state. Uses shownRef via a local slice computed below rather
  // than the filtered chain to keep deps small.
  const shownIds = (classFilter ? snaps.filter((s) => s.classId === classFilter) : snaps)
    .filter((s) => (starredOnly ? !!s.starred : true))
    .filter((s) => !textFilter || (String(s.note || "").toLowerCase().includes(textFilter.toLowerCase())
      || String(s.transcript || "").toLowerCase().includes(textFilter.toLowerCase())
      || String(s.classTitle || "").toLowerCase().includes(textFilter.toLowerCase())))
    .slice()
    .sort((a, b) => Number(!!b.starred) - Number(!!a.starred))
    .slice(0, 12).map((s) => s._id);
  useEffect(() => {
    const next = new URLSearchParams(sp);
    if (openIdx == null || !shownIds[openIdx]) next.delete("snap");
    else next.set("snap", shownIds[openIdx]);
    // Only write if changed to avoid a tight update loop.
    if (next.toString() !== sp.toString()) setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIdx, shownIds.join(",")]);
  // Slideshow ticker: advance every slideshowSec seconds, wrap at shown
  // count. Only runs while a modal is open AND slideshow is on. Turning
  // slideshow off, closing the modal, or changing the interval clears the
  // ticker via the cleanup and rearms with the new period.
  useEffect(() => {
    if (!slideshow || openIdx == null || shownIds.length === 0) return;
    const t = setInterval(() => {
      setOpenIdx((cur) => cur == null ? cur : (cur + 1) % shownIds.length);
    }, slideshowSec * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshow, openIdx == null, shownIds.length, slideshowSec]);
  // Multi-select for bulk actions. Enter mode via "☐ Select" chip; clicking
  // cards toggles selection instead of opening the modal. Explicit mode is
  // friendlier than Ctrl+click magic for the coach audience.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => { if (!selectMode) setSelectedIds(new Set()); }, [selectMode]);
  const qcSnap = useQueryClient();
  async function bulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} snap${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    await runPerSnap(ids, (s, id) => fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(id)}`, {
      method: "DELETE", credentials: "include",
    }), "deletes");
  }
  async function bulkSetStar(starred: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    await runPerSnap(ids, (s, id) => fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(id)}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred }),
    }), "star updates");
  }
  async function bulkSetReviewed(reviewed: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    await runPerSnap(ids, (s, id) => fetch(`${BASE}/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(id)}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed }),
    }), "review updates");
  }
  async function runPerSnap(ids: string[], call: (s: SnapItem, id: string) => Promise<Response>, label: string) {
    const byId: Record<string, SnapItem> = {};
    for (const s of snaps) byId[s._id] = s;
    let failed = 0;
    for (const id of ids) {
      const s = byId[id];
      if (!s) { failed++; continue; }
      try {
        const r = await call(s, id);
        if (!r.ok) failed++;
      } catch { failed++; }
    }
    if (failed > 0) window.alert(`${failed} of ${ids.length} ${label} failed (likely not your snap).`);
    setSelectMode(false);
    qcSnap.invalidateQueries({ queryKey: ["academy-snaps"] });
  }
  const starredCount = snaps.reduce((n, s) => n + (s.starred ? 1 : 0), 0);
  // CSV export of the currently filtered snap set. Client-side blob download,
  // one row per snap. FEN + shapes JSON on the end so a coach can paste any
  // row back into /board-editor?fen=...&shapes=... to reconstruct the
  // position with annotations. Excel-safe: commas quoted, quotes escaped.
  function exportCsv(rows: SnapItem[]) {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = ["At", "Class", "Author", "Starred", "ReviewedAt", "Shapes", "AudioSec", "AudioBytes", "AudioUrl", "Transcript", "Note", "FEN", "OpenLink"];
    const lines = [header.map(esc).join(",")];
    for (const s of rows) {
      const shapes = Array.isArray(s.shapes) ? s.shapes : [];
      const link = shapes.length > 0
        ? `${location.origin}/board-editor?fen=${encodeURIComponent(s.fen)}&shapes=${encodeShapesForUrl(shapes)}`
        : `${location.origin}/board-editor?fen=${encodeURIComponent(s.fen)}`;
      const estSec = estimateAudioSeconds(s.audioBytes);
      const audioUrl = s.hasAudio
        ? `${location.origin}/v2api/api/class/${encodeURIComponent(s.classId)}/snap/${encodeURIComponent(s._id)}/audio`
        : "";
      lines.push([
        new Date(s.at).toISOString(),
        s.classTitle || s.classId,
        s.byName || s.byUserId || "",
        s.starred ? "yes" : "",
        s.reviewedAt ? new Date(s.reviewedAt).toISOString() : "",
        shapes.length > 0 ? JSON.stringify(shapes) : "",
        estSec != null ? String(estSec) : "",
        typeof s.audioBytes === "number" ? String(s.audioBytes) : "",
        audioUrl,
        s.transcript || "",
        s.note || "",
        s.fen,
        link,
      ].map((c) => esc(String(c))).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snaps-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // Tally by class + track the most-recent snap timestamp per class. Chips
  // sort by recency (not count) so a coach who just finished a class sees
  // that class first regardless of how many snaps they took.
  const tally = new Map<string, { title: string; n: number; lastAt: number }>();
  for (const s of snaps) {
    const t = new Date(s.at).getTime();
    const cur = tally.get(s.classId);
    if (cur) { cur.n++; if (t > cur.lastAt) cur.lastAt = t; }
    else tally.set(s.classId, { title: s.classTitle, n: 1, lastAt: t });
  }
  const topClasses = [...tally.entries()].sort((a, b) => b[1].lastAt - a[1].lastAt).slice(0, 5);
  // Starred snaps float to the top so the coach's review shortlist is one
  // scroll-length away regardless of recency. If the starred-only chip is on,
  // non-starred snaps are dropped entirely. Text filter greps note + transcript
  // case-insensitive so "diagonal" surfaces every position where the coach
  // said the word during class or wrote it in the note.
  // Split the query on whitespace so "endgame diag" matches text containing
  // BOTH words in any order (across note / transcript / class title). A row
  // matches only when every token appears in the same field OR spans them
  // combined -- keeps the greedy "endgame class + coach said diagonal" case
  // working. Empty query short-circuits below.
  const qTokens = textFilter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const q = qTokens.join(" ");
  // Week filter (from volume-chart bar click) narrows snaps to a specific
  // 7-day window. weekFilter holds an ISO date string of Sunday-midnight.
  const weekStartMs = weekFilter ? new Date(weekFilter).getTime() : 0;
  const weekEndMs = weekStartMs ? weekStartMs + 7 * 86_400_000 : 0;
  const filtered = (classFilter ? snaps.filter((s) => s.classId === classFilter) : snaps)
    .filter((s) => (starredOnly ? !!s.starred : true))
    .filter((s) => (hideReviewed ? !s.reviewedAt : true))
    .filter((s) => {
      if (!weekStartMs) return true;
      const at = new Date(s.at).getTime();
      return at >= weekStartMs && at < weekEndMs;
    })
    .filter((s) => {
      if (qTokens.length === 0) return true;
      const hay = `${s.note || ""}\n${s.transcript || ""}\n${s.classTitle || ""}`.toLowerCase();
      return qTokens.every((t) => hay.includes(t));
    })
    .slice()
    .sort((a, b) => {
      // Sort key drives the primary order; starred always floats above non-
      // starred within any sort so the coach's shortlist doesn't drown.
      if (!!b.starred !== !!a.starred) return Number(!!b.starred) - Number(!!a.starred);
      if (sortKey === "oldest") return new Date(a.at).getTime() - new Date(b.at).getTime();
      if (sortKey === "arrows") return (b.shapes?.length ?? 0) - (a.shapes?.length ?? 0);
      if (sortKey === "stale") {
        // "stale" = un-reviewed first, then oldest first (most stale on top).
        if (!!b.reviewedAt !== !!a.reviewedAt) return Number(!!a.reviewedAt) - Number(!!b.reviewedAt);
        return new Date(a.at).getTime() - new Date(b.at).getTime();
      }
      return 0; // "recent" -- API order (already reverse-chronological)
    });
  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <h2 className="mb-3 font-display text-lg text-white">📸 Recent snaps <span className="text-xs text-ink-500">({snaps.length})</span></h2>
      {snaps.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <input value={textFilter} onChange={(e) => setTextFilter(e.target.value)}
            ref={searchInputRef}
            placeholder="🔎 search notes / transcript · press /"
            onKeyDown={(e) => { if (e.key === "Escape") { setTextFilter(""); (e.target as HTMLInputElement).blur(); } }}
            className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] text-ink-100 placeholder:text-ink-500 focus:border-brand-500/60 focus:outline-none w-56" />
          {textFilter && (
            <>
              <button onClick={() => setTextFilter("")}
                className="text-[10px] text-ink-400 hover:text-ink-100" title="Clear text filter">✕</button>
              <span className="text-[10px] text-ink-500 tabular-nums" title="Matched snaps in the filtered set">
                {filtered.length} match{filtered.length === 1 ? "" : "es"}
              </span>
            </>
          )}
          {topClasses.length > 1 && (
            <>
              <button onClick={() => setClassFilter("")}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${classFilter === "" ? "border-brand-500/60 bg-brand-500/15 text-brand-100" : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>
                All {snaps.length}
              </button>
              {topClasses.map(([id, { title, n }]) => (
                <button key={id} onClick={() => setClassFilter(id)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${classFilter === id ? "border-brand-500/60 bg-brand-500/15 text-brand-100" : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>
                  <span className="max-w-[18ch] inline-block truncate align-bottom">{title}</span>
                  <span className="ml-1 opacity-70">{n}</span>
                </button>
              ))}
            </>
          )}
          {starredCount > 0 && (
            <>
              {topClasses.length > 1 && <span className="mx-1 h-4 w-px bg-ink-700" />}
              <button onClick={() => setStarredOnly((v) => !v)}
                title="Show only starred snaps"
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${starredOnly
                  ? "border-amber-400/60 bg-amber-500/15 text-amber-100"
                  : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>
                ★ Starred <span className="ml-1 opacity-70">{starredCount}</span>
              </button>
            </>
          )}
          <button onClick={() => setHideReviewed((v) => !v)}
            title="Hide snaps you've already marked reviewed"
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${hideReviewed
              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-100"
              : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800"}`}>
            {hideReviewed ? "✓ Hiding done" : "Hide done"}
          </button>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="Sort snaps"
            className="rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 text-[11px] font-semibold text-ink-400 hover:bg-ink-800">
            <option value="recent">Sort: recent</option>
            <option value="oldest">Sort: oldest</option>
            <option value="arrows">Sort: most arrows</option>
            <option value="stale">Sort: most stale</option>
          </select>
          {weekFilter && (
            <span className="rounded-full border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-100 inline-flex items-center gap-1">
              📅 Week of {new Date(weekFilter).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
              <button onClick={() => setWeekFilter("")} className="ml-1 text-brand-300 hover:text-white" title="Clear week filter">✕</button>
            </span>
          )}
          {(classFilter || starredOnly || textFilter || hideReviewed || sortKey !== "recent" || weekFilter) && (
            <button onClick={() => { setClassFilter(""); setStarredOnly(false); setTextFilter(""); setHideReviewed(false); setSortKey("recent"); setWeekFilter(""); }}
              title="Reset every filter + sort to default"
              className="rounded-full border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-ink-100">
              🔄 Clear all
            </button>
          )}
          <button onClick={() => setSelectMode((v) => !v)}
            title={selectMode ? "Exit multi-select" : "Multi-select for bulk actions"}
            className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${selectMode
              ? "border-brand-500/60 bg-brand-500/15 text-brand-100"
              : "border-ink-700 bg-ink-900 text-ink-400 hover:bg-ink-800 hover:text-ink-100"}`}>
            {selectMode ? "✕ Cancel" : "☐ Select"}
          </button>
          {selectMode && (
            <>
              <button onClick={() => setSelectedIds((cur) => {
                const shown = filtered.slice(0, 12);
                const allShownIds = new Set(shown.map((s) => s._id));
                const allSelected = shown.every((s) => cur.has(s._id));
                if (allSelected) {
                  const nxt = new Set(cur);
                  for (const id of allShownIds) nxt.delete(id);
                  return nxt;
                }
                return new Set([...cur, ...allShownIds]);
              })}
                title="Toggle-select every snap currently in view"
                className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-ink-300 hover:bg-ink-800">
                ✓ All in view
              </button>
              <button onClick={() => setSelectedIds((cur) => {
                // Stale = starred + unreviewed + > 30d old, same rule as
                // the ⏰Nd card badge. One click selects all stale so the
                // coach can bulk-un-star / delete to clear the backlog.
                const shown = filtered.slice(0, 12);
                const nxt = new Set(cur);
                for (const s of shown) {
                  if (!s.starred || s.reviewedAt) continue;
                  const days = Math.floor((Date.now() - new Date(s.at).getTime()) / 86_400_000);
                  if (days >= 30) nxt.add(s._id);
                }
                return nxt;
              })}
                title="Select every snap that's starred + unreviewed + older than 30 days"
                className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20">
                ⏰ Select stale
              </button>
              <button onClick={() => bulkSetStar(true)} disabled={selectedIds.size === 0}
                title="Star selected snaps"
                className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/20 disabled:opacity-40">
                ★ Star <span className="ml-1 opacity-70">{selectedIds.size}</span>
              </button>
              <button onClick={() => bulkSetStar(false)} disabled={selectedIds.size === 0}
                title="Un-star selected snaps"
                className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-ink-300 hover:bg-ink-800 disabled:opacity-40">
                ☆ Un-star
              </button>
              <button onClick={() => bulkSetReviewed(true)} disabled={selectedIds.size === 0}
                title="Mark selected snaps as reviewed"
                className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40">
                ✓ Reviewed
              </button>
              <button onClick={() => bulkSetReviewed(false)} disabled={selectedIds.size === 0}
                title="Un-review selected snaps"
                className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-ink-300 hover:bg-ink-800 disabled:opacity-40">
                ☐ Un-review
              </button>
              <button onClick={bulkDelete} disabled={selectedIds.size === 0}
                title="Delete selected snaps (author-only per snap; failures reported)"
                className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40">
                🗑 Delete <span className="ml-1 opacity-70">{selectedIds.size}</span>
              </button>
            </>
          )}
          <button onClick={() => exportCsv(filtered)}
            title="Download the currently filtered snaps as a CSV (openable in Excel/Sheets)"
            className="rounded-full border border-ink-700 bg-ink-900 px-2.5 py-0.5 text-[11px] font-semibold text-ink-400 hover:bg-ink-800 hover:text-ink-100">
            ⬇ CSV <span className="ml-1 opacity-70">{filtered.length}</span>
          </button>
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="text-sm text-ink-400">No snaps match this filter.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(() => {
            const shown = filtered.slice(0, 12);
            return shown.map((s, i) => (
              <SnapCard key={s._id} s={s}
                isOpen={openIdx === i}
                onOpen={() => setOpenIdx(i)}
                onClose={() => setOpenIdx(null)}
                onNav={(d) => setOpenIdx((cur) => {
                  const cur0 = cur ?? i;
                  const next = cur0 + d;
                  if (next < 0 || next >= shown.length) return cur;
                  return next;
                })}
                neighbours={{ prev: shown[i - 1], next: shown[i + 1] }}
                pos={{ i, n: shown.length }}
                selectMode={selectMode}
                isSelected={selectedIds.has(s._id)}
                onToggleSelect={() => setSelectedIds((cur) => {
                  const nxt = new Set(cur);
                  if (nxt.has(s._id)) nxt.delete(s._id); else nxt.add(s._id);
                  return nxt;
                })}
                query={textFilter}
                slideshow={slideshow}
                onSlideshowToggle={() => setSlideshow((v) => !v)}
                slideshowSec={slideshowSec}
                onSlideshowSec={setSlideshowSec}
              />
            ));
          })()}
        </div>
      )}
    </section>
  );
}

// Single-row renderer for a scheduled class. Live rows get a green ring and
// a Join button; upcoming rows just show the start time and a Copy-link.
function ClassRowUI({ c, live }: { c: ClassRow; live?: boolean }) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  // Copy-link: 1500ms "Copied!" flash then reverts. Falls back to a manual
  // prompt on the (rare) old browsers where navigator.clipboard is missing.
  const [copied, setCopied] = useState(false);
  async function copyJoinLink() {
    const url = `${location.origin}/call/${encodeURIComponent(c._id)}?board=1`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this join link:", url);
    }
  }
  // Auto-summary settings editor (small PATCH via /class/schedule/:id).
  const [autoEditorOpen, setAutoEditorOpen] = useState(false);
  const [autoDraftOn, setAutoDraftOn] = useState(!!c.autoSummary);
  const [autoDraftNote, setAutoDraftNote] = useState(c.autoSummaryNote || "");
  const [autoApplyToSeries, setAutoApplyToSeries] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  // Preview data for the editor: dry-run of what the auto-send WILL include
  // right now. Coach uses this to sanity-check ("will 5 students actually get
  // the email? are today's snaps included?"). null = not yet loaded.
  type AutoPreview = { attendees: number; snapCount: number; hasRecording: boolean };
  const [autoPreview, setAutoPreview] = useState<AutoPreview | null>(null);
  async function openAutoEditor() {
    setAutoDraftOn(!!c.autoSummary);
    setAutoDraftNote(c.autoSummaryNote || "");
    setAutoApplyToSeries(false);
    setAutoPreview(null);
    setAutoEditorOpen(true);
    try {
      const r = await fetch(`${BASE}/api/academy/classes/${encodeURIComponent(c._id)}/summary`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, note: "" }),
      }).then((res) => res.json());
      if (r?.ok) setAutoPreview({ attendees: r.attendees ?? 0, snapCount: r.snapCount ?? 0, hasRecording: !!r.hasRecording });
    } catch { /* preview is best-effort */ }
  }
  async function saveAuto() {
    if (autoSaving) return;
    setAutoSaving(true);
    try {
      const url = `${BASE}/api/class/schedule/${encodeURIComponent(c._id)}${autoApplyToSeries && c.seriesId ? "?scope=series" : ""}`;
      const r = await fetch(url, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoSummary: autoDraftOn, autoSummaryNote: autoDraftOn ? autoDraftNote : "" }),
      });
      if (r.ok) { qc.invalidateQueries({ queryKey: ["academy-schedule"] }); setAutoEditorOpen(false); }
    } catch { /* silent — modal stays open, coach can retry */ }
    finally { setAutoSaving(false); }
  }
  const [previewOpen, setPreviewOpen] = useState(false);
  type SummaryPreview = { attendees: number; snapCount: number; hasRecording: boolean; recordingUrl: string | null };
  const [preview, setPreview] = useState<SummaryPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  async function openPreview() {
    setPreviewOpen(true); setPreview(null); setPreviewErr(null); setSendMsg(null);
    try {
      const r = await fetch(`${BASE}/api/academy/classes/${encodeURIComponent(c._id)}/summary`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: true, note: "" }),
      }).then((res) => res.json());
      if (!r.ok) { setPreviewErr(r.error || "Preview failed"); return; }
      setPreview({ attendees: r.attendees, snapCount: r.snapCount, hasRecording: r.hasRecording, recordingUrl: r.recordingUrl });
    } catch { setPreviewErr("Network error"); }
  }
  async function reallySend() {
    if (sending) return;
    setSending(true); setSendMsg(null);
    try {
      const r = await fetch(`${BASE}/api/academy/classes/${encodeURIComponent(c._id)}/summary`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }),
      }).then((res) => res.json());
      if (!r.ok) setSendMsg(r.error || "Failed");
      else {
        setSendMsg(`Sent to ${r.sent} student${r.sent === 1 ? "" : "s"}${r.failed ? ` (${r.failed} failed)` : ""}`);
        setPreviewOpen(false);
        qc.invalidateQueries({ queryKey: ["academy-schedule"] });
      }
    } catch { setSendMsg("Network error"); }
    finally { setSending(false); }
  }
  return (
    <div className={`mb-1 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${live ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-800/40"}`}>
      <div className="flex-1 min-w-0">
        <div className="text-white truncate">{c.title}</div>
        <div className="text-[11px] text-ink-400">
          {c.coach}{" · "}{fmtStartAt(c.startAt)}{" · "}{c.durationMin}m
          {typeof c.attendedCount === "number" && c.mine && <span className="ml-2 text-emerald-300">✓ {c.attendedCount} attended</span>}
          {c.mine && c.summarySentAt && (
            <span className="ml-2 text-brand-300" title={`Summary emailed ${new Date(c.summarySentAt).toLocaleString()}`}>
              📧 sent {fmtAgo(c.summarySentAt)}
            </span>
          )}
          {c.mine && c.autoSummary && !c.summarySentAt && !c.autoSummaryFailedAt && (
            <span className="ml-2 text-ink-500" title="Auto-email will fire 15 min after class ends">🤖 auto</span>
          )}
          {c.mine && c.autoSummaryFailedAt && !c.summarySentAt && (
            <button onClick={openPreview}
              className="ml-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20"
              title={`Auto-send failed ${fmtAgo(c.autoSummaryFailedAt)}${c.autoSummaryFailedCount ? ` — all ${c.autoSummaryFailedCount} email(s) bounced` : ""}${c.autoSummaryFailedError ? `\n${c.autoSummaryFailedError}` : ""}. Click to preview + retry.`}>
              ⚠️ auto failed — retry
            </button>
          )}
          {c.mine && !c.summarySentAt && (
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openAutoEditor(); }}
              className="ml-1 text-[10px] text-ink-500 hover:text-ink-100"
              title={c.autoSummary ? "Edit auto-summary settings" : "Enable auto-summary"}>
              ⚙︎
            </button>
          )}
          {sendMsg && <span className="ml-2 text-brand-300">· {sendMsg}</span>}
        </div>
      </div>
      {c.mine && (
        <button onClick={openPreview} disabled={sending}
          className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-2 py-1 text-[11px] font-semibold text-brand-100 hover:bg-brand-500/20 disabled:opacity-50"
          title="Preview + email per-student class recap via dw-otp">
          {sending ? "Sending…" : "📧 Summary"}
        </button>
      )}
      {autoEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !autoSaving && setAutoEditorOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl2 border border-ink-700 bg-ink-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg text-white">🤖 Auto-summary settings</h3>
              <button onClick={() => !autoSaving && setAutoEditorOpen(false)} className="text-ink-400 hover:text-white text-sm">Esc</button>
            </div>
            <div className="text-[11px] text-ink-400 mb-3">{c.title} · {fmtStartAt(c.startAt)}</div>
            {(() => {
              const endMs = new Date(c.startAt).getTime() + c.durationMin * 60_000;
              const preClass = Date.now() < endMs;
              return autoPreview ? (
                <div className="mb-3">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-500">
                    What the auto-send would contain right now
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-2">
                      <div className="text-lg font-semibold text-white tabular-nums">{autoPreview.attendees}</div>
                      <div className="text-[10px] uppercase tracking-wide text-ink-400">Recipients</div>
                    </div>
                    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-2">
                      <div className="text-lg font-semibold text-white tabular-nums">{autoPreview.snapCount}</div>
                      <div className="text-[10px] uppercase tracking-wide text-ink-400">Snaps</div>
                    </div>
                    <div className={`rounded-lg border p-2 ${autoPreview.hasRecording ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-800/40"}`}>
                      <div className={`text-lg font-semibold tabular-nums ${autoPreview.hasRecording ? "text-emerald-300" : "text-ink-500"}`}>{autoPreview.hasRecording ? "✓" : "—"}</div>
                      <div className="text-[10px] uppercase tracking-wide text-ink-400">Recording</div>
                    </div>
                  </div>
                  {preClass && (
                    <div className="mt-2 text-[11px] text-ink-500">
                      Class hasn't ended yet — these counts will grow as students attend and you snap positions.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-3 text-[11px] text-ink-500">Loading preview…</div>
              );
            })()}
            <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
              <input type="checkbox" checked={autoDraftOn} onChange={(e) => setAutoDraftOn(e.target.checked)}
                className="rounded border-ink-600 bg-ink-800 text-brand-500 focus:ring-brand-500/40" />
              Auto-email a class summary 15 min after this class ends
            </label>
            {autoDraftOn && (
              <div className="mt-3">
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">Note baked into the auto-send (optional)</label>
                <textarea value={autoDraftNote} onChange={(e) => setAutoDraftNote(e.target.value)}
                  rows={3} maxLength={500}
                  placeholder='e.g. "Practise today’s tactics 20 min tomorrow morning."'
                  className="w-full resize-none rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-brand-500 focus:outline-none" />
                <div className="mt-1 text-right text-[10px] text-ink-500 tabular-nums">{autoDraftNote.length}/500</div>
              </div>
            )}
            {c.seriesId && (
              <label className="mt-3 flex items-center gap-2 text-xs text-ink-300 cursor-pointer">
                <input type="checkbox" checked={autoApplyToSeries} onChange={(e) => setAutoApplyToSeries(e.target.checked)}
                  className="rounded border-ink-600 bg-ink-800 text-brand-500 focus:ring-brand-500/40" />
                📅 Apply to every FUTURE class in this series
                {typeof c.seriesTotal === "number" && <span className="ml-1 text-ink-500">({c.seriesIndex} / {c.seriesTotal})</span>}
              </label>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => !autoSaving && setAutoEditorOpen(false)}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Cancel</button>
              <button onClick={saveAuto} disabled={autoSaving}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {autoSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !sending && setPreviewOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl2 border border-ink-700 bg-ink-900 p-6 shadow-2xl">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-display text-lg text-white">📧 Class summary preview</h3>
              <button onClick={() => !sending && setPreviewOpen(false)} className="text-ink-400 hover:text-white text-sm">Esc</button>
            </div>
            <div className="text-sm text-ink-200">
              <div className="mb-1 text-white truncate"><b>{c.title}</b></div>
              <div className="text-[11px] text-ink-400">{c.coach} · {fmtStartAt(c.startAt)} · {c.durationMin}m</div>
            </div>
            {previewErr && <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{previewErr}</div>}
            {!preview && !previewErr && <div className="mt-3 text-sm text-ink-400">Computing preview…</div>}
            {c.summarySentAt && (
              <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                ⚠️ Already sent {fmtAgo(c.summarySentAt)} — sending again will land a duplicate in each student's inbox.
              </div>
            )}
            {preview && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-2">
                  <div className="text-xl font-semibold text-white tabular-nums">{preview.attendees}</div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-400">Recipients</div>
                </div>
                <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-2">
                  <div className="text-xl font-semibold text-white tabular-nums">{preview.snapCount}</div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-400">Snaps included</div>
                </div>
                <div className={`rounded-lg border p-2 ${preview.hasRecording ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-800/40"}`}>
                  <div className={`text-xl font-semibold tabular-nums ${preview.hasRecording ? "text-emerald-300" : "text-ink-500"}`}>{preview.hasRecording ? "✓" : "—"}</div>
                  <div className="text-[10px] uppercase tracking-wide text-ink-400">Recording</div>
                </div>
              </div>
            )}
            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-400">Optional note to attach</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3}
                placeholder="e.g. Nice work on the Italian today — practice the tactics I flagged."
                className="w-full resize-none rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-brand-500" />
              <div className="mt-1 text-right text-[10px] text-ink-500 tabular-nums">{note.length}/500</div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => !sending && setPreviewOpen(false)}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-800">Cancel</button>
              <button onClick={reallySend} disabled={sending || !preview || preview.attendees === 0}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${c.summarySentAt
                  ? "bg-amber-600 hover:bg-amber-500"
                  : "bg-brand-600 hover:bg-brand-500"}`}>
                {sending
                  ? "Sending…"
                  : preview
                    ? (c.summarySentAt ? `Re-send to ${preview.attendees}` : `Send to ${preview.attendees}`)
                    : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Route to our own from-scratch video call (/call/:room?board=1) — feature
       *  parity with Jitsi now: mesh up to 8, TURN, AV1, chat, hand, reactions,
       *  moderator role, spotlight, blur, live captions, screen share, recording,
       *  chess-native board mode. Attendance auto-writes to classAttendance on
       *  join via the same collection the /academy roster reads. Jitsi fallback
       *  at meet.harinitharanjith.com still works if a user types it directly. */}
      <button onClick={copyJoinLink}
        className="rounded-lg border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] font-semibold text-ink-100 hover:bg-ink-700"
        title="Copy the join link to share with a student or parent">
        {copied ? "✓ Copied" : "🔗 Copy link"}
      </button>
      <Link to={`/call/${encodeURIComponent(c._id)}?board=1`}
        className={`rounded-lg px-3 py-1 text-xs font-semibold ${live ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-brand-600 text-white hover:bg-brand-500"}`}>
        {live ? "Join now" : "Open class"}
      </Link>
    </div>
  );
}
