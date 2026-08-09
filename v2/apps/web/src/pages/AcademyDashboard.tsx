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
import { Link, Navigate } from "react-router-dom";
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
  const Tile = ({ label, value, tone }: { label: string; value: number | string; tone: string }) => (
    <div className={`rounded-xl2 border ${tone} p-3 text-center`}>
      <div className="text-2xl font-semibold text-white tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      <Tile label="Classes today" value={classesToday} tone="border-ink-700 bg-ink-900" />
      <Tile label="Live now" value={liveNow} tone={liveNow > 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-ink-700 bg-ink-900"} />
      <Tile label="Snaps today" value={snapsToday} tone="border-ink-700 bg-ink-900" />
      <Tile label="Recordings today" value={recordingsToday} tone="border-ink-700 bg-ink-900" />
      <Tile label="★ Starred (all)" value={starredTotal} tone={starredTotal > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-ink-700 bg-ink-900"} />
    </div>
  );
}

// Individual snap card with inline note-edit. Only the original snap author
// can edit (server enforces via PATCH /api/class/:id/snap/:snapId). Card is
// a Link by default; edit mode swaps in a textarea + save/cancel so the
// coach can fix a typo without re-opening the board.
function SnapCard({ s, isOpen, onOpen, onClose, onNav, neighbours, pos, selectMode, isSelected, onToggleSelect }: {
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
          s.note && <div className="mt-1 text-[12px] text-ink-300 line-clamp-2">"{s.note}"</div>
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
                <span className="hidden sm:inline" title="← / → step through snaps">← →</span>
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
                {s.note && <div className="rounded border border-ink-700 bg-ink-800/40 p-2 text-ink-200 whitespace-pre-wrap">"{s.note}"</div>}
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
                    </>
                  )}
                </div>
              </div>
            </div>
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
type SnapItem = { _id: string; classId: string; classTitle: string; fen: string; note: string; byName: string; byUserId?: string; at: string; shapes?: SnapShape[]; starred?: boolean; hasAudio?: boolean; audioBytes?: number };
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
function RecentSnapsSection({ snaps }: { snaps: SnapItem[] }) {
  const [classFilter, setClassFilter] = useState<string>(""); // "" = all
  const [starredOnly, setStarredOnly] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  // Reset the open snap when filters change so we don't end up pointing at a
  // row that just got filtered out.
  useEffect(() => { setOpenIdx(null); }, [classFilter, starredOnly]);
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
    const header = ["At", "Class", "Author", "Starred", "Shapes", "AudioSec", "AudioBytes", "AudioUrl", "Note", "FEN", "OpenLink"];
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
        shapes.length > 0 ? JSON.stringify(shapes) : "",
        estSec != null ? String(estSec) : "",
        typeof s.audioBytes === "number" ? String(s.audioBytes) : "",
        audioUrl,
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
  // non-starred snaps are dropped entirely.
  const filtered = (classFilter ? snaps.filter((s) => s.classId === classFilter) : snaps)
    .filter((s) => (starredOnly ? !!s.starred : true))
    .slice()
    .sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
  return (
    <section className="rounded-xl2 border border-ink-700 bg-ink-900 p-5">
      <h2 className="mb-3 font-display text-lg text-white">📸 Recent snaps <span className="text-xs text-ink-500">({snaps.length})</span></h2>
      {snaps.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
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
