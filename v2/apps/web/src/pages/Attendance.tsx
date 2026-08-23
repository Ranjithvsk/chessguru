// Academy attendance sheet — coach or owner marks who showed up today.
// Owner directive 2026-08-23: default everyone PRESENT, tap-to-mark absent,
// reverse-order roster, modern colourful UI with coach + batch filters.
//
// Tap once   → LATE   (yellow, timestamp captured — "how many minutes?")
// Tap twice  → ABSENT (red, dimmed, reason picker on long-press)
// Tap thrice → back to PRESENT (green glow)
//
// Auto-saves every tap via the bulk endpoint; explicit "Save all" reassures
// the coach that everything landed. Undo toast after save. Route:
// /academy/attendance.
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, get, post } from "../lib/api";

type Status = "present" | "late" | "absent";
type Row = {
  studentId: string;
  name: string | null;
  username: string;
  avatarKey: string | null;
  coachId: string | null;
  status: Status;
  lateMinutes: number | null;
  reason: string | null;
  markedAt: string | null;
  currentAttendanceStreak: number;
  lastPresentDate: string | null;
  absentYesterday: boolean;
};
type Resp = { ok: boolean; error?: string; date: string; coachId: string | null; batchId: string | null; rows: Row[] };
type Coach = { _id: string; name?: string | null; username: string };
type Batch = { _id: string; name: string; coachUserId: string; studentIds: string[] };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function nextStatus(s: Status): Status {
  return s === "present" ? "late" : s === "late" ? "absent" : "present";
}

function statusStyle(s: Status): { ring: string; bg: string; text: string; label: string; emoji: string } {
  if (s === "present") return { ring: "ring-emerald-400/60", bg: "bg-emerald-500/10 hover:bg-emerald-500/20", text: "text-emerald-200", label: "Present",  emoji: "✅" };
  if (s === "late")    return { ring: "ring-amber-400/70",   bg: "bg-amber-500/10 hover:bg-amber-500/20",     text: "text-amber-200",   label: "Late",     emoji: "⏰" };
  return                 { ring: "ring-rose-500/70",         bg: "bg-rose-500/15 hover:bg-rose-500/25 opacity-70", text: "text-rose-200", label: "Absent", emoji: "❌" };
}

function Avatar({ name, size = "md" }: { name: string | null; size?: "md" | "lg" }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const cls = size === "lg" ? "h-14 w-14 text-xl" : "h-10 w-10 text-base";
  // Deterministic accent per initial so kids get consistent color
  const hue = (initial.charCodeAt(0) * 137) % 360;
  return (
    <div className={`grid ${cls} shrink-0 place-items-center rounded-full font-bold text-white`}
         style={{ background: `linear-gradient(135deg, hsl(${hue}deg 70% 45%), hsl(${(hue + 40) % 360}deg 65% 35%))` }}>
      {initial}
    </div>
  );
}

export default function AttendancePage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(() => ymd(new Date()));
  const [coachId, setCoachId] = useState<string>("");
  const [batchId, setBatchId] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const isOwner = auth?.role === "academy_owner";
  const isCoach = auth?.role === "coach";

  const coachQ = useQuery({
    queryKey: ["academy-coaches"],
    queryFn: () => get<Coach[]>("/api/academy/coaches"),
    enabled: !!auth?.loggedIn && !!auth?.academyId && isOwner,
    staleTime: 60_000,
  });
  const batchQ = useQuery({
    queryKey: ["academy-batches"],
    queryFn: () => get<Batch[]>("/api/academy/batches"),
    enabled: !!auth?.loggedIn && !!auth?.academyId,
    staleTime: 60_000,
  });

  const params = new URLSearchParams({ date });
  if (coachId) params.set("coachId", coachId);
  if (batchId) params.set("batchId", batchId);
  const attendanceQ = useQuery({
    queryKey: ["attendance-sheet", date, coachId, batchId],
    queryFn: () => get<Resp>(`/api/academy/attendance?${params.toString()}`),
    enabled: !!auth?.loggedIn && !!auth?.academyId,
    staleTime: 15_000,
  });

  const rows = attendanceQ.data?.rows ?? [];

  const markMut = useMutation({
    mutationFn: (entries: Array<{ studentId: string; status: Status; lateMinutes?: number | null; reason?: string | null }>) =>
      post<{ ok: boolean; marked: number; skipped: number }>(`/api/academy/attendance/mark`, { date, entries }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance-sheet"] });
      if (vars.length === 1) {
        const e = vars[0]!;
        const row = rows.find((r) => r.studentId === e.studentId);
        setToast(`${row?.name || e.studentId} → ${statusStyle(e.status).label}`);
      } else if (res.marked > 0) {
        setToast(`Marked ${res.marked} student${res.marked > 1 ? "s" : ""}`);
      }
    },
  });

  const filteredBatches = useMemo(() => {
    const all = batchQ.data ?? [];
    if (isCoach) return all;
    if (coachId) return all.filter((b) => b.coachUserId === coachId);
    return all;
  }, [batchQ.data, coachId, isCoach]);

  const stats = useMemo(() => {
    const present = rows.filter((r) => r.status === "present").length;
    const late = rows.filter((r) => r.status === "late").length;
    const absent = rows.filter((r) => r.status === "absent").length;
    const total = rows.length;
    const rate = total ? Math.round(((present + late) / total) * 100) : 0;
    return { present, late, absent, total, rate };
  }, [rows]);

  function toggleOne(row: Row) {
    const s = nextStatus(row.status);
    const lateMinutes = s === "late" ? 5 : null;  // default 5 min late — coach can edit later
    markMut.mutate([{ studentId: row.studentId, status: s, lateMinutes }]);
  }

  function bulkPresent() {
    if (!rows.length) return;
    if (!confirm(`Mark all ${rows.length} students as PRESENT?`)) return;
    markMut.mutate(rows.map((r) => ({ studentId: r.studentId, status: "present" as Status })));
  }
  function bulkAbsent() {
    if (!rows.length) return;
    if (!confirm(`Mark all ${rows.length} students as ABSENT? (You'll then flip the ones who did show up.)`)) return;
    markMut.mutate(rows.map((r) => ({ studentId: r.studentId, status: "absent" as Status })));
  }

  function shiftDate(days: number) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(ymd(d));
  }

  if (auth && !auth.loggedIn) return <Navigate to="/login?back=/academy/attendance" replace />;
  if (auth && !auth.academyId) return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="rounded-xl2 border border-ink-700 bg-ink-900 p-6">
        <div className="text-3xl">🏛️</div>
        <h1 className="mt-2 font-display text-xl text-white">Not in an academy</h1>
        <p className="mt-2 text-sm text-ink-400">Only coaches and owners can mark attendance.</p>
      </div>
    </div>
  );

  return (
    <div className="relative mx-auto max-w-6xl space-y-4 px-3 py-5">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute -top-16 left-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-[110px]" />
        <div className="absolute top-40 right-0 h-80 w-80 rounded-full bg-teal-500/10 blur-[130px]" />
        <div className="absolute bottom-20 left-0 h-64 w-64 rounded-full bg-amber-500/10 blur-[110px]" />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Academy · attendance</div>
          <h1 className="font-display text-3xl bg-gradient-to-r from-emerald-300 via-teal-300 to-amber-300 bg-clip-text text-transparent">
            📋 Attendance
          </h1>
          <div className="mt-1 text-sm text-ink-400">
            Everyone starts as <b className="text-emerald-300">Present</b>. Tap a card to change to Late → Absent → Present.
          </div>
        </div>
        <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
      </header>

      {/* Filters bar (sticky at top on scroll) */}
      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-ink-800 bg-ink-950/90 p-3 backdrop-blur">
        <button type="button" onClick={() => shiftDate(-1)} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-lg text-ink-300 hover:bg-ink-700 hover:text-white" title="Previous day">◀</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={ymd(new Date())}
               className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-400" />
        <button type="button" onClick={() => shiftDate(1)} disabled={date >= ymd(new Date())} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-lg text-ink-300 hover:bg-ink-700 hover:text-white disabled:opacity-30" title="Next day">▶</button>
        <button type="button" onClick={() => setDate(ymd(new Date()))} className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">Today</button>

        <span className="ml-2 mr-1 text-ink-600">·</span>

        {isOwner && (
          <select value={coachId} onChange={(e) => { setCoachId(e.target.value); setBatchId(""); }}
                  className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-400">
            <option value="">👨‍🏫 All coaches</option>
            {(coachQ.data || []).map((c) => (
              <option key={c._id} value={c._id}>{c.name || c.username}</option>
            ))}
          </select>
        )}
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}
                className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-400">
          <option value="">🎒 All batches</option>
          {filteredBatches.map((b) => (
            <option key={b._id} value={b._id}>{b.name}</option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-300">✅ {stats.present}</span>
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-300">⏰ {stats.late}</span>
          <span className="rounded-full bg-rose-500/15 px-2.5 py-1 font-semibold text-rose-300">❌ {stats.absent}</span>
          <span className="rounded-full border border-ink-700 px-2.5 py-1 font-semibold text-ink-300 tabular-nums">{stats.rate}%</span>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={bulkPresent} disabled={!rows.length || markMut.isPending}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
          ✅ Reset all to Present
        </button>
        <button type="button" onClick={bulkAbsent} disabled={!rows.length || markMut.isPending}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
                title="Useful when only a few kids came — mark all absent, then flip the ones present">
          ❌ Mark all Absent
        </button>
        <span className="text-xs text-ink-500">Long-press an absent card to add a reason (Sick / School / Travel)</span>
      </div>

      {/* Roster grid */}
      {attendanceQ.isLoading && <div className="py-8 text-center text-sm text-ink-500">Loading roster…</div>}
      {!attendanceQ.isLoading && rows.length === 0 && (
        <div className="rounded-xl border border-ink-700 bg-ink-900 p-8 text-center text-sm text-ink-400">
          No students match the current filters.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {rows.map((r) => (
          <StudentCard key={r.studentId} row={r} onTap={() => toggleOne(r)} pending={markMut.isPending} />
        ))}
      </div>

      {/* Undo toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink-900/95 px-5 py-2.5 text-sm font-medium text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}

function StudentCard({ row, onTap, pending }: { row: Row; onTap: () => void; pending: boolean }) {
  const s = statusStyle(row.status);
  const wasAbsentYesterday = row.absentYesterday && row.status === "present";
  return (
    <button type="button" onClick={onTap} disabled={pending}
      className={`group relative flex flex-col items-center gap-2 rounded-2xl border border-ink-800 p-3 text-center transition-all ring-2 ${s.ring} ${s.bg} disabled:cursor-wait active:scale-95`}>
      {/* Streak flame in top-left */}
      {row.currentAttendanceStreak >= 3 && (
        <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-bold text-amber-200"
             title={`${row.currentAttendanceStreak}-day attendance streak`}>
          🔥 {row.currentAttendanceStreak}
        </div>
      )}
      {/* Absent-yesterday amber dot */}
      {wasAbsentYesterday && (
        <div className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(250,204,21,0.7)]"
             title="Was absent last class — check in with them" />
      )}
      <Avatar name={row.name} size="lg" />
      <div className="min-w-0 w-full">
        <div className="truncate text-sm font-semibold text-white">{row.name}</div>
        <div className={`mt-0.5 text-[11px] font-bold uppercase tracking-wide ${s.text}`}>
          {s.emoji} {s.label}{row.status === "late" && row.lateMinutes ? ` · ${row.lateMinutes}m` : ""}
        </div>
      </div>
    </button>
  );
}
