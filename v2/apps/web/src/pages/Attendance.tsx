// Academy attendance sheet — coach or owner marks who showed up today.
// Owner directive 2026-08-23: default everyone PRESENT, tap-to-mark absent,
// reverse-order roster, modern colourful UI with coach + batch filters.
//
// Tap once   → ABSENT (red — most common exception, first tap)
// Tap twice  → LATE   (yellow, defaults to 5 min)
// Tap thrice → back to PRESENT (green)
//
// Long-press a card → detail modal (edit minutes, reason, or open student
// profile). Auto-saves every tap via the bulk endpoint; undo toast for 2.2s.
// Route: /academy/attendance.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api, get, post } from "../lib/api";
import { loadFaceApi, detectAllFaces } from "../lib/faceApi";

type Status = "present" | "late" | "absent";
type DayStatus = "present" | "late" | "absent" | "unmarked";
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
  source: "manual" | "qr" | "live-class" | "default";
  autoJoin: { classId: string; joinedAt: string | null; lastSeenAt: string | null } | null;
  excused?: boolean;
  excuseDocUrl?: string | null;
  excuseNote?: string | null;
  excuseUploadedByRole?: string | null;
  excuseUploadedAt?: string | null;
  currentAttendanceStreak: number;
  lastPresentDate: string | null;
  absentYesterday: boolean;
  last7: Array<{ day: string; status: DayStatus }>;
};
type Resp = { ok: boolean; error?: string; date: string; coachId: string | null; batchId: string | null; rows: Row[]; lastClassDate: string | null };
type Coach = { _id: string; name?: string | null; username: string };
type Batch = { _id: string; name: string; coachUserId: string; studentIds: string[] };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Owner directive 2026-08-23: first tap = ABSENT (the common case — most
// students are present by default, coach only touches the ones missing).
// Cycle: Present → Absent → Late → Present.
function nextStatus(s: Status): Status {
  return s === "present" ? "absent" : s === "absent" ? "late" : "present";
}

function statusStyle(s: Status, excused = false): { ring: string; bg: string; text: string; label: string; emoji: string } {
  if (s === "present") return { ring: "ring-emerald-400/60", bg: "bg-emerald-500/10 hover:bg-emerald-500/20", text: "text-emerald-200", label: "Present",  emoji: "✅" };
  if (s === "late")    return { ring: "ring-amber-400/70",   bg: "bg-amber-500/10 hover:bg-amber-500/20",     text: "text-amber-200",   label: "Late",     emoji: "⏰" };
  // Excused = softer purple treatment vs the harsh rose for unexcused absent.
  if (excused)         return { ring: "ring-purple-400/60",  bg: "bg-purple-500/10 hover:bg-purple-500/20",   text: "text-purple-200",  label: "Excused",  emoji: "📎" };
  return                 { ring: "ring-rose-500/70",         bg: "bg-rose-500/15 hover:bg-rose-500/25 opacity-70", text: "text-rose-200", label: "Absent", emoji: "❌" };
}

function dayDotColor(s: DayStatus): string {
  if (s === "present") return "bg-emerald-400";
  if (s === "late") return "bg-amber-400";
  if (s === "absent") return "bg-rose-500";
  return "bg-ink-700";
}

function Avatar({ name, size = "md" }: { name: string | null; size?: "md" | "lg" }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const cls = size === "lg" ? "h-14 w-14 text-xl" : "h-10 w-10 text-base";
  const hue = (initial.charCodeAt(0) * 137) % 360;
  return (
    <div className={`grid ${cls} shrink-0 place-items-center rounded-full font-bold text-white`}
         style={{ background: `linear-gradient(135deg, hsl(${hue}deg 70% 45%), hsl(${(hue + 40) % 360}deg 65% 35%))` }}>
      {initial}
    </div>
  );
}

const REASONS = ["Sick", "School event", "Travel", "No reason given", "Family emergency"];

export default function AttendancePage() {
  const { data: auth } = useQuery({ queryKey: ["auth-me"], queryFn: api.me });
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(() => ymd(new Date()));
  const [coachId, setCoachId] = useState<string>("");
  const [batchId, setBatchId] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);   // long-press → open modal
  const [qrOpen, setQrOpen] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);

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
  const lastClassDate = attendanceQ.data?.lastClassDate ?? null;

  const sheetKey = ["attendance-sheet", date, coachId, batchId];
  const markMut = useMutation({
    mutationFn: (entries: Array<{ studentId: string; status: Status; lateMinutes?: number | null; reason?: string | null }>) =>
      post<{ ok: boolean; marked: number; skipped: number }>(`/api/academy/attendance/mark`, { date, entries }),
    // Optimistic UI (owner ask 2026-08-23 "click should be instant"):
    // patch the cached sheet BEFORE the server responds so the card flips
    // immediately. Cache a snapshot so we can roll back on error. Coach
    // can keep tapping other cards while the previous POST is still in
    // flight — each mutation is independent.
    onMutate: async (entries) => {
      await qc.cancelQueries({ queryKey: sheetKey });
      const prev = qc.getQueryData<Resp>(sheetKey);
      if (prev) {
        const patched: Resp = {
          ...prev,
          rows: prev.rows.map((r) => {
            const e = entries.find((x) => x.studentId === r.studentId);
            if (!e) return r;
            return {
              ...r,
              status: e.status,
              lateMinutes: e.status === "late" ? (e.lateMinutes ?? r.lateMinutes ?? 5) : null,
              reason: e.reason ?? r.reason,
              source: "manual",
            };
          }),
        };
        qc.setQueryData(sheetKey, patched);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx: any) => {
      // Roll back on failure — restore the pre-mutation snapshot.
      if (ctx?.prev) qc.setQueryData(sheetKey, ctx.prev);
      setToast("Save failed — reverted");
    },
    onSettled: () => {
      // Reconcile with server truth in the background (won't flicker since
      // the optimistic patch already matches).
      qc.invalidateQueries({ queryKey: ["attendance-sheet"] });
    },
    onSuccess: (res, vars) => {
      if (vars.length === 1) {
        const e = vars[0]!;
        const row = rows.find((r) => r.studentId === e.studentId);
        setToast(`${row?.name || e.studentId} → ${statusStyle(e.status).label}`);
      } else if (res.marked > 0) {
        setToast(`Marked ${res.marked} student${res.marked > 1 ? "s" : ""}`);
      }
    },
  });

  const copyMut = useMutation({
    mutationFn: (fromDate: string) => post<{ ok: boolean; marked: number; note?: string; error?: string }>(`/api/academy/attendance/copy`, {
      fromDate, toDate: date, coachId: coachId || undefined, batchId: batchId || undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["attendance-sheet"] });
      setToast(res.error ? `Copy failed: ${res.error}` : res.note || `Copied ${res.marked} non-present marks from last class`);
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
    const autoDetected = rows.filter((r) => r.source === "live-class" || r.source === "qr").length;
    const total = rows.length;
    const rate = total ? Math.round(((present + late) / total) * 100) : 0;
    return { present, late, absent, autoDetected, total, rate };
  }, [rows]);

  function toggleOne(row: Row) {
    const s = nextStatus(row.status);
    const lateMinutes = s === "late" ? (row.lateMinutes || 5) : null;
    markMut.mutate([{ studentId: row.studentId, status: s, lateMinutes, reason: row.reason }]);
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
            Everyone starts as <b className="text-emerald-300">Present</b>. Tap once = <b className="text-rose-300">Absent</b>, again = <b className="text-amber-300">Late</b>, again = Present. Long-press for details.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/academy/attendance/dashboard" className="rounded-lg bg-fuchsia-600/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-500">📊 Dashboard →</Link>
          <Link to="/academy" className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 hover:text-white">← Academy</Link>
        </div>
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
          {stats.autoDetected > 0 && (
            <span className="rounded-full bg-sky-500/15 px-2.5 py-1 font-semibold text-sky-300" title="Auto-detected from Live Class join">✨ {stats.autoDetected} live</span>
          )}
          <span className="rounded-full border border-ink-700 px-2.5 py-1 font-semibold text-ink-300 tabular-nums">{stats.rate}%</span>
        </div>
      </div>

      {/* Bulk + copy actions */}
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
        {lastClassDate && (
          <button type="button" onClick={() => copyMut.mutate(lastClassDate)} disabled={copyMut.isPending}
                  className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-40"
                  title={`Copy Late/Absent marks from ${lastClassDate}`}>
            📋 Copy from last class ({lastClassDate})
          </button>
        )}
        <button type="button" onClick={() => setQrOpen(true)}
                className="rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:shadow-sky-500/30"
                title="Show QR — kids scan with phone to mark themselves present">
          📱 QR Check-in
        </button>
        <button type="button" onClick={() => setFaceOpen(true)}
                className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:shadow-purple-500/30"
                title="Camera → recognize enrolled faces → auto-mark present">
          👤 Face Check-in
        </button>
        <button type="button" onClick={() => setVoiceOpen(true)}
                className="rounded-lg bg-gradient-to-r from-orange-600 to-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:shadow-orange-500/30"
                title='Say "Aarav absent, Priya late 5 minutes" → auto-marks'>
          🎙️ Voice Mark
        </button>
        {stats.absent > 0 && (
          <button type="button" onClick={() => setNotifyOpen(true)}
                  className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:shadow-emerald-500/30"
                  title={`WhatsApp the parents of all ${stats.absent} absent students`}>
            💬 Notify absent parents ({stats.absent})
          </button>
        )}
        <span className="text-xs text-ink-500">Tap = cycle status · Long-press = edit reason/minutes</span>
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
          <StudentCard key={r.studentId} row={r} onTap={() => toggleOne(r)} onLongPress={() => setDetail(r)} />
        ))}
      </div>

      {/* QR check-in modal */}
      {qrOpen && (
        <QrCheckinModal date={date} coachId={coachId || null} batchId={batchId || null}
                        onClose={() => setQrOpen(false)}
                        onCheckin={() => qc.invalidateQueries({ queryKey: ["attendance-sheet"] })} />
      )}

      {/* Face check-in modal */}
      {faceOpen && (
        <FaceCheckinModal date={date} coachId={coachId || null} batchId={batchId || null}
                          onClose={() => setFaceOpen(false)}
                          onMatch={() => qc.invalidateQueries({ queryKey: ["attendance-sheet"] })} />
      )}

      {/* Voice mark modal */}
      {voiceOpen && (
        <VoiceMarkModal rows={rows} onClose={() => setVoiceOpen(false)}
                        onApply={(entries) => {
                          markMut.mutate(entries);
                          setVoiceOpen(false);
                        }} />
      )}

      {/* Notify-absent-parents bulk modal */}
      {notifyOpen && (
        <NotifyAbsentModal
          date={date}
          absentRows={rows.filter((r) => r.status === "absent")}
          onClose={() => setNotifyOpen(false)}
        />
      )}

      {/* Detail modal — edit minutes / reason, or view profile */}
      {detail && (
        <DetailModal
          row={detail}
          date={date}
          onClose={() => setDetail(null)}
          onSave={(status, lateMinutes, reason) => {
            markMut.mutate([{ studentId: detail.studentId, status, lateMinutes, reason }]);
            setDetail(null);
          }}
        />
      )}

      {/* Undo toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink-900/95 px-5 py-2.5 text-sm font-medium text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StudentCard({ row, onTap, onLongPress }: { row: Row; onTap: () => void; onLongPress: () => void }) {
  const s = statusStyle(row.status, !!row.excused);
  const wasAbsentYesterday = row.absentYesterday && row.status === "present";
  // Auto-marked via live class join OR student's own QR scan.
  const isAutoDetected = row.source === "live-class" || row.source === "qr";
  const autoLabel = row.source === "qr" ? "📱 QR" : "✨ Live";
  const autoTitle = row.source === "qr"
    ? `Self check-in via QR at ${fmtTime(row.autoJoin?.joinedAt || null)}`
    : `Auto-detected: joined Live Class at ${fmtTime(row.autoJoin?.joinedAt || null)}`;
  // Conflict: coach marked absent BUT student joined the live call or scanned QR.
  const hasConflict = row.source === "manual" && row.status === "absent" && !!row.autoJoin;
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const startPress = () => {
    longPressed.current = false;
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      onLongPress();
    }, 500);
  };
  const endPress = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  const handleClick = () => {
    if (longPressed.current) return;
    onTap();
  };

  return (
    <button type="button" onClick={handleClick}
      onMouseDown={startPress} onMouseUp={endPress} onMouseLeave={endPress}
      onTouchStart={startPress} onTouchEnd={endPress} onTouchCancel={endPress}
      style={{ touchAction: "manipulation" }}
      className={`group relative flex flex-col items-center gap-2 rounded-2xl border border-ink-800 p-3 text-center transition-all ring-2 ${s.ring} ${s.bg} active:scale-95`}>
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
      {/* Auto-detected badge — top-right (QR self-checkin OR live-class auto-join) */}
      {isAutoDetected && (
        <div className={`absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${row.source === "qr" ? "bg-indigo-500/25 text-indigo-200" : "bg-sky-500/25 text-sky-200"}`}
             title={autoTitle}>
          {autoLabel}
        </div>
      )}
      {/* Conflict badge — coach said absent, but the student showed up on video */}
      {hasConflict && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-orange-500/30 px-1.5 py-0.5 text-[10px] font-bold text-orange-200 animate-pulse"
             title={`Marked absent but joined Live Class at ${fmtTime(row.autoJoin?.joinedAt || null)} — tap to reconcile`}>
          ⚠️ Joined
        </div>
      )}
      <Avatar name={row.name} size="lg" />
      <div className="min-w-0 w-full">
        {/* text-ink-100 flips correctly in both themes (light text on dark bg,
            dark text on light bg). text-white would be exempted by the global
            "text-white on bg-emerald-*" rule and stay white on the 10%-opacity
            light-mode surface — invisible. */}
        <div className="truncate text-sm font-semibold text-ink-100">{row.name}</div>
        <div className={`mt-0.5 text-[11px] font-bold uppercase tracking-wide ${s.text}`}>
          {s.emoji} {s.label}{row.status === "late" && row.lateMinutes ? ` · ${row.lateMinutes}m` : ""}
        </div>
        {row.reason && row.status === "absent" && (
          <div className="mt-0.5 truncate text-[10px] italic text-ink-500">{row.reason}</div>
        )}
        {isAutoDetected && row.autoJoin?.joinedAt && (
          <div className={`mt-0.5 text-[10px] ${row.source === "qr" ? "text-indigo-400/80" : "text-sky-400/80"}`}>
            {row.source === "qr" ? "scanned" : "joined"} {fmtTime(row.autoJoin.joinedAt)}
          </div>
        )}
      </div>
      {/* Last 7 days mini-strip: oldest → newest, tiny dots */}
      {row.last7 && row.last7.length > 0 && (
        <div className="flex gap-0.5 pt-1" title="Last 7 days (oldest → newest)">
          {row.last7.map((d) => (
            <span key={d.day} className={`h-1.5 w-1.5 rounded-full ${dayDotColor(d.status)}`} title={`${d.day}: ${d.status}`} />
          ))}
        </div>
      )}
    </button>
  );
}

function QrCheckinModal({ date, coachId, batchId, onClose, onCheckin }: {
  date: string;
  coachId: string | null;
  batchId: string | null;
  onClose: () => void;
  onCheckin: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [session, setSession] = useState<{ token: string; expiresAt: string; checkinUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create the session on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await post<{ ok: boolean; token: string; expiresAt: string; checkinUrl: string; error?: string }>(
          "/api/academy/attendance/qr/create",
          { date, coachId: coachId || undefined, batchId: batchId || undefined },
        );
        if (cancelled) return;
        if (!res.ok) { setError(res.error || "Failed to create QR."); return; }
        setSession({ token: res.token, expiresAt: res.expiresAt, checkinUrl: res.checkinUrl });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to create QR.");
      }
    })();
    return () => { cancelled = true; };
  }, [date, coachId, batchId]);

  // Render QR onto canvas whenever session URL changes
  useEffect(() => {
    if (!session?.checkinUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, session.checkinUrl, {
      width: 320, margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).catch(() => setError("Failed to render QR."));
  }, [session?.checkinUrl]);

  // Poll status every 3s so the "N checked in" counter feels live.
  const statusQ = useQuery({
    queryKey: ["qr-checkin-status", session?.token],
    queryFn: () => get<{ ok: boolean; count: number; recent: Array<{ studentId: string; name: string; at: string }> }>(
      `/api/academy/attendance/qr/${session!.token}/status`,
    ),
    enabled: !!session?.token,
    refetchInterval: 3000,
  });

  // When count grows, invalidate the parent's sheet so it re-renders.
  const lastCount = useRef(0);
  useEffect(() => {
    const n = statusQ.data?.count ?? 0;
    if (n > lastCount.current) {
      lastCount.current = n;
      onCheckin();
    }
  }, [statusQ.data?.count, onCheckin]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-gradient-to-b from-ink-900 to-ink-950 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-400">Attendance · check-in</div>
          <h2 className="mt-1 font-display text-2xl text-white">📱 Scan to check in</h2>
          <p className="mt-1 text-xs text-ink-400">Kids scan with their phone camera — they'll be marked <b className="text-emerald-300">Present</b> instantly.</p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
        )}

        {!error && !session && (
          <div className="grid h-80 place-items-center text-sm text-ink-500">Generating QR…</div>
        )}

        {session && (
          <>
            <div className="grid place-items-center rounded-xl bg-white p-4">
              <canvas ref={canvasRef} className="h-72 w-72" />
            </div>
            <div className="mt-3 text-center text-[11px] text-ink-500 break-all">
              or open: <span className="text-sky-300">{session.checkinUrl}</span>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-ink-800/60 px-3 py-2">
              <div className="text-xs text-ink-400">Checked in so far</div>
              <div className="flex items-center gap-2">
                <span className="grid h-8 min-w-8 place-items-center rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 px-2 text-sm font-bold text-white tabular-nums">
                  {statusQ.data?.count ?? 0}
                </span>
              </div>
            </div>
            {statusQ.data?.recent && statusQ.data.recent.length > 0 && (
              <div className="mt-2 max-h-24 overflow-y-auto text-xs">
                {statusQ.data.recent.slice(0, 5).map((r) => (
                  <div key={r.studentId} className="flex justify-between border-b border-ink-800 py-1">
                    <span className="text-white">{r.name}</span>
                    <span className="text-ink-500">{new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-ink-700 px-4 py-2 text-sm font-semibold text-ink-300 hover:bg-ink-800 hover:text-white">Close</button>
        </div>
      </div>
    </div>
  );
}

/** Bulk absent-notification modal — TWO paths:
 *
 *   🚀 Auto-send all — one click, server calls Meta WhatsApp Cloud API
 *      to send the approved template to every absent kid's parent.
 *      Requires WA_TPL_ABSENT_NOTICE template approved by Meta.
 *
 *   📱 Manual — per-row wa.me click-through that opens WhatsApp on the
 *      coach's device with a pre-filled message. Works today, no
 *      template approval needed. Always available as a fallback.
 *
 *  Shows result summary after auto-send (sent / skipped / failed) plus
 *  per-row status. Manual buttons remain visible for retries. */
function NotifyAbsentModal({ date, absentRows, onClose }: { date: string; absentRows: Row[]; onClose: () => void }) {
  const [sentLocal, setSentLocal] = useState<Set<string>>(new Set());
  const [autoRes, setAutoRes] = useState<null | {
    ok: boolean; error?: string; dryRun?: boolean; sent?: number; skipped?: number; failed?: number;
    results?: Array<{ studentId: string; parentName: string | null; status: string; error?: string }>;
  }>(null);
  const autoMut = useMutation({
    mutationFn: (force: boolean) => post<{ ok: boolean; error?: string; dryRun?: boolean; sent?: number; skipped?: number; failed?: number; results?: any[] }>(
      "/api/academy/attendance/notify-absent",
      { studentIds: absentRows.map((r) => r.studentId), date, force },
    ),
    onSuccess: (res) => {
      setAutoRes(res);
      // Mark all with a sent/skipped/dry-run status as done locally
      const donIds = new Set<string>((res.results || [])
        .filter((r: any) => r.status === "sent" || r.status === "skipped" || r.status === "dry-run")
        .map((r: any) => r.studentId));
      setSentLocal((prev) => new Set([...prev, ...donIds]));
    },
  });
  const totalWithParents = autoRes?.results?.filter((r) => r.status !== "no-phone").length ?? absentRows.length;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">Attendance · notify parents</div>
          <h2 className="mt-1 font-display text-2xl text-white">💬 WhatsApp absent parents</h2>
          <p className="mt-1 text-xs text-ink-400">{absentRows.length} student{absentRows.length === 1 ? "" : "s"} absent</p>
        </div>

        {/* Auto-send bar — the fast path */}
        <div className="mb-3 rounded-xl border border-sky-500/30 bg-gradient-to-r from-sky-500/10 to-emerald-500/10 p-3">
          <button type="button" onClick={() => autoMut.mutate(false)} disabled={autoMut.isPending}
                  className="w-full rounded-lg bg-gradient-to-r from-sky-600 to-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-md hover:shadow-lg disabled:opacity-40">
            {autoMut.isPending ? "Sending…" : "🚀 Auto-send all via WhatsApp"}
          </button>
          {autoRes && (
            <div className="mt-2 text-xs">
              {autoRes.ok ? (
                <div className="flex flex-wrap items-center gap-2">
                  {autoRes.dryRun && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-200">DRY-RUN mode</span>}
                  {(autoRes.sent ?? 0) > 0 && <span className="rounded-full bg-emerald-500/25 px-2 py-0.5 text-emerald-200">✓ {autoRes.sent} sent</span>}
                  {(autoRes.skipped ?? 0) > 0 && <span className="rounded-full bg-ink-700 px-2 py-0.5 text-ink-300">↺ {autoRes.skipped} already sent</span>}
                  {(autoRes.failed ?? 0) > 0 && <span className="rounded-full bg-rose-500/25 px-2 py-0.5 text-rose-200">✗ {autoRes.failed} failed</span>}
                  {(autoRes.failed ?? 0) > 0 && (
                    <button type="button" onClick={() => autoMut.mutate(true)}
                            className="ml-1 text-ink-400 underline hover:text-white">Retry failed</button>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
                  ⚠️ {autoRes.error} <span className="text-ink-500">— use the manual buttons below (they work today).</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-500">
          <span className="h-px flex-1 bg-ink-800" />
          <span>or send manually</span>
          <span className="h-px flex-1 bg-ink-800" />
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {absentRows.map((r) => {
            const rowRes = autoRes?.results?.find((x) => x.studentId === r.studentId);
            return (
              <AbsentNotifyRow key={r.studentId} row={r} date={date}
                               sent={sentLocal.has(r.studentId)}
                               autoStatus={rowRes?.status}
                               autoError={rowRes?.error}
                               onSent={() => setSentLocal((s) => new Set(s).add(r.studentId))} />
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-ink-500">{sentLocal.size} / {totalWithParents} notified</div>
          <button type="button" onClick={onClose} className="rounded-lg border border-ink-700 px-4 py-2 text-sm font-semibold text-ink-300 hover:bg-ink-800 hover:text-white">Done</button>
        </div>
      </div>
    </div>
  );
}

function AbsentNotifyRow({ row, date, sent, autoStatus, autoError, onSent }: {
  row: Row; date: string; sent: boolean; autoStatus?: string; autoError?: string; onSent: () => void;
}) {
  const q = useQuery({
    queryKey: ["parent-contact", row.studentId, date],
    queryFn: () => get<{
      ok: boolean;
      error?: string;
      contacts?: Array<{ parentId: string; name: string; phoneE164: string | null; waLink: string | null }>;
    }>(`/api/academy/attendance/parent-contact/${encodeURIComponent(row.studentId)}?date=${date}`),
    staleTime: 60_000,
  });
  const contacts = q.data?.contacts?.filter((c) => c.waLink) ?? [];
  const autoBadge = autoStatus === "sent" ? { text: "✓ auto-sent", cls: "bg-emerald-500/25 text-emerald-200" }
                  : autoStatus === "dry-run" ? { text: "◔ dry-run", cls: "bg-amber-500/25 text-amber-200" }
                  : autoStatus === "skipped" ? { text: "↺ already sent", cls: "bg-ink-700 text-ink-300" }
                  : autoStatus === "no-phone" ? { text: "✗ no phone", cls: "bg-amber-500/25 text-amber-200" }
                  : autoStatus === "error" ? { text: "✗ failed", cls: "bg-rose-500/25 text-rose-200" }
                  : null;
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 transition ${sent || autoStatus === "sent" || autoStatus === "dry-run" ? "border-emerald-500/40 bg-emerald-500/10" : "border-ink-800 bg-ink-950"}`}>
      <Avatar name={row.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-sm font-semibold text-white">{row.name}</div>
          {autoBadge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${autoBadge.cls}`}>{autoBadge.text}</span>}
        </div>
        {row.reason && <div className="truncate text-[11px] italic text-ink-500">Reason: {row.reason}</div>}
        {autoError && <div className="truncate text-[10px] text-rose-300" title={autoError}>{autoError}</div>}
        {q.isLoading && <div className="text-[11px] text-ink-500">Loading…</div>}
        {!q.isLoading && contacts.length === 0 && <div className="text-[11px] text-amber-300">No parent phone on file</div>}
      </div>
      <div className="flex flex-col gap-1">
        {contacts.map((c) => (
          <a key={c.parentId} href={c.waLink!} target="_blank" rel="noreferrer" onClick={onSent}
             className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition ${sent ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"}`}>
            {sent ? "✓ " : "📱 "}{c.name}
          </a>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Voice-mark parsing (client-side, no server call).
// Coach dictates like "Aarav absent, Priya late 5 minutes, Rohit present".
// Owner ask 2026-08-23. Chrome/Edge have full Web Speech API; Safari partial;
// Firefox unsupported → we show a clear "not supported" message.
// ─────────────────────────────────────────────────────────────────────────
type VoiceIntent = {
  fragment: string;                          // original text this came from
  studentId: string | null;                  // null = ambiguous / no match
  matchedName: string | null;
  candidates: Array<{ studentId: string; name: string; score: number }>;   // top 3 for picker
  status: Status;
  lateMinutes?: number | null;
};

// Simple normalized-Levenshtein similarity 0..1.
function nameScore(a: string, b: string): number {
  const A = a.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const B = b.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (!A || !B) return 0;
  if (A === B) return 1;
  // Prefer prefix / contained matches
  if (B.startsWith(A) || A.startsWith(B)) return 0.9;
  if (B.includes(A) || A.includes(B)) return 0.75;
  // Compare first-word (first name) — most spoken names are just first names
  const [af] = A.split(" "); const [bf] = B.split(" ");
  if (af && bf && af === bf) return 0.85;
  // Char-overlap ratio as a cheap fuzzy fallback
  const shorter = A.length < B.length ? A : B;
  const longer  = A.length < B.length ? B : A;
  let hits = 0;
  for (const c of new Set(shorter)) if (longer.includes(c)) hits++;
  return hits / new Set(longer).size;
}

function parseVoiceTranscript(transcript: string, roster: Row[]): VoiceIntent[] {
  const text = transcript.trim();
  if (!text) return [];
  // Split on commas + " and " + period + newline
  const fragments = text.split(/,|\band\b|\.|\n/gi).map((s) => s.trim()).filter(Boolean);
  const intents: VoiceIntent[] = [];
  for (const frag of fragments) {
    const lower = frag.toLowerCase();
    // Status detection (order matters — "late" before "absent" in case of "late 5 minutes")
    let status: Status = "present";
    if (/\b(late|delayed|minutes?\s+late)\b/.test(lower)) status = "late";
    else if (/\b(absent|missing|not here|not present|didn'?t come|no show)\b/.test(lower)) status = "absent";
    else if (/\b(present|here|attending|came)\b/.test(lower)) status = "present";
    else continue;   // no status keyword → skip fragment
    // Minutes detection
    let lateMinutes: number | null = null;
    if (status === "late") {
      const m = lower.match(/(\d{1,3})\s*(?:min|minute|minutes|m)?\b/);
      lateMinutes = m ? Math.max(1, Math.min(300, parseInt(m[1]!, 10))) : 5;
    }
    // Strip status/number words to isolate the name-ish portion
    const nameGuess = frag
      .replace(/\b(absent|late|present|here|missing|attending|came|delayed|not\s+here|not\s+present|didn'?t\s+come|no\s+show|minutes?|min|by)\b/gi, "")
      .replace(/\d+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // Score every roster row + pick top-5 candidates. Threshold loosened
    // (0.7→0.6, gap 0.15→0.10) because voice-transcribed Indian names are
    // often lightly off (e.g. "Aarav" → "R chunk", "Priya" → "prayer").
    // Coach can always click a candidate chip to correct.
    const scored = roster.map((r) => ({
      studentId: r.studentId,
      name: r.name || r.username,
      score: nameScore(nameGuess, r.name || r.username),
    })).sort((a, b) => b.score - a.score).slice(0, 5);
    const best = scored[0];
    const confident = best && best.score >= 0.6 && (!scored[1] || best.score - scored[1].score >= 0.10);
    intents.push({
      fragment: frag,
      studentId: confident ? best!.studentId : null,
      matchedName: confident ? best!.name : null,
      candidates: scored.filter((s) => s.score > 0.2),   // was 0.3
      status,
      lateMinutes,
    });
  }
  return intents;
}

/** Voice-mark modal — coach dictates roll call, we parse names + statuses
 *  from the transcript and let them review + apply. */
function VoiceMarkModal({ rows, onClose, onApply }: {
  rows: Row[];
  onClose: () => void;
  onApply: (entries: Array<{ studentId: string; status: Status; lateMinutes?: number | null }>) => void;
}) {
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [intents, setIntents] = useState<VoiceIntent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"en-IN" | "en-US" | "en-GB">("en-IN");
  const recRef = useRef<any>(null);
  const finalRef = useRef<string>("");
  const wantListenRef = useRef(false);   // user's intent — auto-restart on onend

  // Human-friendly error messages per SpeechRecognitionErrorEvent.error code.
  const explainError = (code: string): string => {
    switch (code) {
      case "not-allowed":
      case "service-not-allowed":
        return "🎤 Microphone permission denied. Click the 🔒 icon in your address bar → allow mic → try again.";
      case "no-speech":
        return "Didn't hear anything — try speaking louder or closer to the mic.";
      case "audio-capture":
        return "No microphone detected. Plug one in or check your system audio settings.";
      case "network":
        return "Recognition needs an internet connection (Chrome sends audio to Google servers).";
      case "aborted":
        return null as any;   // user-initiated stop, don't show
      case "language-not-supported":
        return `Language ${lang} not supported. Try switching to en-US or en-GB below.`;
      default:
        return `Recognition error: ${code}`;
    }
  };

  // Build/rebuild the recognizer whenever the lang changes.
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSupported(!!SR);
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (ev: any) => {
      let interim = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript + " "; else interim += r[0].transcript;
      }
      if (final) finalRef.current += final;
      setInterimText(interim);
      setTranscript(finalRef.current + interim);
      setError(null);
    };
    rec.onend = () => {
      // Web Speech auto-stops after ~5-10s silence. If user still wants to
      // listen, restart transparently so a pause between names doesn't kill
      // the session.
      if (wantListenRef.current) {
        try { rec.start(); } catch { setListening(false); }
      } else {
        setListening(false);
      }
    };
    rec.onerror = (ev: any) => {
      const code = String(ev?.error || "unknown");
      const msg = explainError(code);
      if (msg) setError(msg);
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
        wantListenRef.current = false;
        setListening(false);
      }
    };
    recRef.current = rec;
    return () => {
      wantListenRef.current = false;
      try { rec.stop(); } catch { /* ignore */ }
    };
  }, [lang]);

  // Re-parse whenever transcript changes
  useEffect(() => {
    setIntents(parseVoiceTranscript(transcript, rows));
  }, [transcript, rows]);

  const start = () => {
    if (!recRef.current) return;
    setError(null);
    wantListenRef.current = true;
    try { recRef.current.start(); setListening(true); }
    catch (e: any) {
      // InvalidStateError = already running; stop then restart cleanly.
      try { recRef.current.stop(); } catch { /* ignore */ }
      setTimeout(() => { try { recRef.current.start(); setListening(true); } catch { setError("Couldn't start recognition — try refresh."); } }, 100);
    }
  };
  const stop = () => {
    wantListenRef.current = false;
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch { /* ignore */ }
    setListening(false);
  };
  const clear = () => {
    finalRef.current = "";
    setTranscript("");
    setInterimText("");
    setIntents([]);
    setError(null);
  };

  const pickCandidate = (idx: number, studentId: string, name: string) => {
    setIntents((prev) => prev.map((it, i) => i === idx ? { ...it, studentId, matchedName: name } : it));
  };

  const confirmed = intents.filter((it) => !!it.studentId);
  const applyAll = () => {
    if (!confirmed.length) return;
    onApply(confirmed.map((it) => ({
      studentId: it.studentId!,
      status: it.status,
      lateMinutes: it.status === "late" ? (it.lateMinutes ?? 5) : null,
    })));
  };

  // Manual edit — coach can type/paste directly, bypassing the mic entirely.
  const setManualTranscript = (v: string) => {
    finalRef.current = v;
    setInterimText("");
    setTranscript(v);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-orange-300">Attendance · voice</div>
            <h2 className="mt-0.5 font-display text-xl text-white">🎙️ Voice Mark</h2>
            <p className="text-xs text-ink-400">Say: <i>"Aarav absent, Priya late 5 minutes, Rohit present"</i></p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl text-ink-400 hover:text-white">×</button>
        </div>

        {supported === false && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            ⚠️ Voice recognition isn't supported in this browser. Use Chrome, Edge, or Safari on desktop / Android Chrome on mobile.
          </div>
        )}

        {supported !== false && (
          <>
            {/* Mic button + language + transcript */}
            <div className="flex flex-col items-center gap-3 py-2">
              <button type="button" onClick={listening ? stop : start}
                      className={`grid h-20 w-20 place-items-center rounded-full text-3xl shadow-lg transition ${listening ? "bg-rose-600 animate-pulse ring-4 ring-rose-500/40" : "bg-gradient-to-br from-orange-500 to-red-600 hover:scale-105"}`}
                      title={listening ? "Stop listening" : "Start listening"}>
                🎙️
              </button>
              <div className="text-xs text-ink-500">
                {listening ? (interimText ? `Hearing: "${interimText}"` : "Listening…") : "Tap the mic to start"}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-ink-500">
                <span>Language:</span>
                {(["en-IN", "en-US", "en-GB"] as const).map((l) => (
                  <button key={l} type="button" onClick={() => setLang(l)}
                          className={`rounded-full border px-2 py-0.5 ${lang === l ? "border-orange-400 bg-orange-500/20 text-orange-200" : "border-ink-700 text-ink-400 hover:text-white"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
                {error}
              </div>
            )}

            {/* Editable transcript — coach can also just type/paste here */}
            <textarea
              value={transcript}
              onChange={(e) => setManualTranscript(e.target.value)}
              placeholder='Or type directly: "Aarav absent, Priya late 5 minutes, Rohit here"'
              rows={3}
              className="w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm text-ink-100 outline-none focus:border-orange-400"
            />
            <div className="mt-1 text-[10px] text-ink-500">
              💡 Tip: If a name gets mis-heard, just fix it in the box above — parsing updates live.
            </div>

            {/* Parsed intents */}
            {intents.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-[10px] uppercase text-ink-500">Parsed ({intents.length})</div>
                  <button type="button" onClick={clear} className="text-[11px] text-ink-500 hover:text-white">clear</button>
                </div>
                <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                  {intents.map((it, i) => {
                    const s = statusStyle(it.status);
                    return (
                      <div key={i} className={`rounded-lg border p-2 text-xs ${it.studentId ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="min-w-0 flex-1 italic text-ink-400 truncate">"{it.fragment}"</div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.text} bg-black/20`}>
                            {s.emoji} {s.label}{it.lateMinutes ? ` ${it.lateMinutes}m` : ""}
                          </span>
                        </div>
                        {it.studentId ? (
                          <div className="mt-1 text-emerald-300">✓ {it.matchedName}</div>
                        ) : it.candidates.length > 0 ? (
                          <div className="mt-1">
                            <div className="text-amber-300">? Ambiguous — pick one:</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {it.candidates.map((c) => (
                                <button key={c.studentId} type="button" onClick={() => pickCandidate(i, c.studentId, c.name)}
                                        className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20">
                                  {c.name} <span className="text-ink-500">({(c.score * 100).toFixed(0)}%)</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1 text-rose-300">✗ No matching student</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-ink-500">
            {confirmed.length > 0 && <span className="text-emerald-300">{confirmed.length} ready · </span>}
            {intents.length - confirmed.length > 0 && <span className="text-amber-300">{intents.length - confirmed.length} unresolved</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:text-white">Cancel</button>
            <button type="button" onClick={applyAll} disabled={confirmed.length === 0}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
              Apply {confirmed.length}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Excuse upload panel — shown inside DetailModal for absent students. Lets
 *  the coach/owner/parent upload a doctor's note (image or PDF) OR just add
 *  a text note. Uploading marks the absence as "excused" — softer purple
 *  treatment on the card, and dashboard rollups exclude it from absent
 *  counts + watchlist triggers. Owner ask 2026-08-23. */
function ExcuseUploadPanel({ row, date }: { row: Row; date: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uploadDoc = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const url = `/api/academy/attendance/excuse/${encodeURIComponent(row.studentId)}/${encodeURIComponent(date)}${note ? `?note=${encodeURIComponent(note)}` : ""}`;
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { setMsg({ ok: false, text: j?.error || `Upload failed (${res.status})` }); }
      else {
        setMsg({ ok: true, text: "Excuse uploaded — marked as Excused." });
        qc.invalidateQueries({ queryKey: ["attendance-sheet"] });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Upload failed." });
    } finally { setBusy(false); }
  };

  const noteOnly = async () => {
    if (!note.trim()) { setMsg({ ok: false, text: "Enter a note or attach a file." }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await post<{ ok: boolean; error?: string }>(`/api/academy/attendance/excuse-note/${encodeURIComponent(row.studentId)}/${encodeURIComponent(date)}`, { note });
      if (!res.ok) setMsg({ ok: false, text: res.error || "Failed" });
      else {
        setMsg({ ok: true, text: "Note saved — marked as Excused." });
        qc.invalidateQueries({ queryKey: ["attendance-sheet"] });
      }
    } catch (e: any) { setMsg({ ok: false, text: e?.message || "Failed" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-xs font-semibold text-purple-200">📎 Mark as excused</label>
        {row.excused && (
          <span className="rounded-full bg-purple-500/25 px-2 py-0.5 text-[10px] font-bold text-purple-200">
            ✓ Already excused{row.excuseUploadedByRole ? ` by ${row.excuseUploadedByRole}` : ""}
          </span>
        )}
      </div>
      {row.excused && row.excuseDocUrl && (
        <a href={row.excuseDocUrl} target="_blank" rel="noreferrer"
           className="mb-2 inline-block text-xs text-purple-300 underline hover:text-purple-200">
          📄 View uploaded document →
        </a>
      )}
      {row.excused && row.excuseNote && (
        <div className="mb-2 rounded bg-ink-950 px-2 py-1.5 text-xs text-ink-300">Note: {row.excuseNote}</div>
      )}
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
             placeholder="Optional note (e.g. Doctor visit)" maxLength={500}
             className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-purple-400" />
      <div className="mt-2 flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={uploadDoc}
               className="hidden" id={`excuse-file-${row.studentId}`} />
        <label htmlFor={`excuse-file-${row.studentId}`}
               className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/20 ${busy ? "opacity-40" : ""}`}>
          📎 Attach doc (image/PDF)
        </label>
        <button type="button" onClick={noteOnly} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-500/20 disabled:opacity-40">
          Save note only
        </button>
      </div>
      {msg && (
        <div className={`mt-2 text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</div>
      )}
    </div>
  );
}

/** Inline "📱 WhatsApp Parent" contact list — fetches on mount, shows one
 *  button per linked parent with the pre-filled wa.me link. Coach clicks →
 *  WhatsApp opens on their device (desktop or phone) with the message ready
 *  to send. Zero setup, no Meta template approval needed. */
function ParentContactButtons({ studentId }: { studentId: string }) {
  const [date] = useState(ymd(new Date()));
  const q = useQuery({
    queryKey: ["parent-contact", studentId, date],
    queryFn: () => get<{
      ok: boolean;
      error?: string;
      contacts?: Array<{ parentId: string; name: string; phoneE164: string | null; waLink: string | null; mobileConsent: boolean }>;
    }>(`/api/academy/attendance/parent-contact/${encodeURIComponent(studentId)}?date=${date}`),
    staleTime: 60_000,
  });
  if (q.isLoading) return <div className="mt-4 text-xs text-ink-500">Loading parent contacts…</div>;
  if (!q.data?.ok) return <div className="mt-4 text-xs text-rose-400">{q.data?.error || "Couldn't load parent contacts."}</div>;
  const contacts = q.data.contacts || [];
  if (contacts.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-ink-700 bg-ink-950 p-3 text-xs text-ink-400">
        No parent contact linked yet. <Link to="/academy" className="text-brand-300 hover:underline">Link a parent →</Link>
      </div>
    );
  }
  const usable = contacts.filter((c) => c.waLink);
  return (
    <div className="mt-4">
      <label className="mb-1 block text-xs font-semibold text-ink-400">Notify parent via WhatsApp</label>
      {usable.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          Parent linked but no mobile number on file. Ask them to add it in the Family portal.
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {usable.map((c) => (
          <a key={c.parentId} href={c.waLink!} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25">
            📱 WhatsApp {c.name}
          </a>
        ))}
      </div>
    </div>
  );
}

/** Coach's face check-in — fullscreen video, detects ALL faces per frame,
 *  sends each descriptor to server for match, auto-marks matched students
 *  present. Confidence threshold is coach-tunable (0.40 tight → 0.70 loose).
 *  Owner ask 2026-08-23. */
function FaceCheckinModal({ date, coachId, batchId, onClose, onMatch }: {
  date: string;
  coachId: string | null;
  batchId: string | null;
  onClose: () => void;
  onMatch: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.55);
  const [recognized, setRecognized] = useState<Array<{ studentId: string; name: string; at: number; distance: number }>>([]);
  const [pending, setPending] = useState(false);
  const recentIdsRef = useRef<Map<string, number>>(new Map());   // studentId → lastMatchedAt (ms)

  const rosterQ = useQuery({
    queryKey: ["face-roster"],
    queryFn: () => get<{ ok: boolean; total: number; enrolled: number }>("/api/academy/attendance/face/roster"),
    staleTime: 60_000,
  });

  // Camera + models
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadFaceApi();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e: any) {
        setError(e?.message || "Could not access camera. Please grant permission.");
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    };
  }, []);

  // Recognition loop — runs every 1.2s while modal open. Cooldown per
  // recognized student (60s) so the same face doesn't spam the log.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !videoRef.current) return;
      try {
        setPending(true);
        const detections = await detectAllFaces(videoRef.current);
        for (const det of detections) {
          const res: any = await post("/api/academy/attendance/face/match", {
            descriptor: Array.from(det.descriptor),
            date, coachId, batchId, threshold,
          });
          if (res?.ok && res.match) {
            const now = Date.now();
            const last = recentIdsRef.current.get(res.match.studentId) || 0;
            if (now - last > 60_000) {
              recentIdsRef.current.set(res.match.studentId, now);
              setRecognized((prev) => {
                const seen = new Set(prev.map((r) => r.studentId));
                if (seen.has(res.match.studentId)) return prev;
                return [{ ...res.match, at: now }, ...prev].slice(0, 20);
              });
              onMatch();
            }
          }
        }
      } catch { /* transient, ignore */ }
      finally { setPending(false); }
      if (!cancelled) setTimeout(tick, 1200);
    };
    tick();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, threshold]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-ink-700 bg-ink-950 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-purple-300">Attendance · face check-in</div>
            <h2 className="mt-0.5 font-display text-xl text-white">👤 Point at students to check them in</h2>
          </div>
          <button type="button" onClick={onClose} className="text-2xl text-ink-400 hover:text-white">×</button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {!error && rosterQ.data && rosterQ.data.enrolled === 0 && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            ⚠️ No students have enrolled their face yet. Share <b>/settings/face</b> with them so they can enroll once.
          </div>
        )}

        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="w-full" />
          {!ready && !error && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-ink-300">
              Loading camera + face models…
            </div>
          )}
          {pending && (
            <div className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">🔍 scanning…</div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-ink-900 p-3">
          <div className="min-w-0 flex-1">
            <label className="text-[10px] uppercase text-ink-500">Confidence threshold: <b className="text-white">{threshold.toFixed(2)}</b></label>
            <input type="range" min={0.40} max={0.70} step={0.01} value={threshold}
                   onChange={(e) => setThreshold(Number(e.target.value))} className="w-full accent-purple-500" />
            <div className="flex justify-between text-[9px] text-ink-500">
              <span>0.40 tight (fewer matches)</span>
              <span>0.70 loose (more false ✓)</span>
            </div>
          </div>
          {rosterQ.data && (
            <div className="text-xs text-ink-400">
              <b className="text-white tabular-nums">{rosterQ.data.enrolled}</b> / {rosterQ.data.total} enrolled
            </div>
          )}
        </div>

        {recognized.length > 0 && (
          <div className="mt-3 rounded-lg bg-ink-900 p-3">
            <div className="mb-1 text-[10px] uppercase text-ink-500">Checked in this session ({recognized.length})</div>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {recognized.map((r) => (
                <div key={r.studentId + r.at} className="flex items-center justify-between rounded bg-ink-950 px-2 py-1 text-xs">
                  <span className="font-semibold text-emerald-300">✓ {r.name}</span>
                  <span className="text-ink-500 tabular-nums">dist {r.distance.toFixed(2)} · {new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailModal({ row, date, onClose, onSave }: {
  row: Row;
  date: string;
  onClose: () => void;
  onSave: (status: Status, lateMinutes: number | null, reason: string | null) => void;
}) {
  const [status, setStatus] = useState<Status>(row.status);
  const [lateMinutes, setLateMinutes] = useState<number>(row.lateMinutes || 5);
  const [reason, setReason] = useState<string>(row.reason || "");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <Avatar name={row.name} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">{row.name}</div>
            <div className="text-xs text-ink-400">@{row.username}</div>
            {row.currentAttendanceStreak > 0 && (
              <div className="mt-0.5 text-[11px] text-amber-300">🔥 {row.currentAttendanceStreak}-day streak</div>
            )}
          </div>
        </div>

        {/* Status picker */}
        <div className="mt-4 flex gap-2">
          {(["present", "late", "absent"] as Status[]).map((s) => {
            const st = statusStyle(s);
            const active = status === s;
            return (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={`flex-1 rounded-xl border p-2.5 text-sm font-semibold transition ${active ? `border-transparent ${st.bg} ${st.text} ring-2 ${st.ring}` : "border-ink-700 bg-ink-950 text-ink-400 hover:text-white"}`}>
                {st.emoji} {st.label}
              </button>
            );
          })}
        </div>

        {/* Late-minutes editor */}
        {status === "late" && (
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold text-ink-400">Minutes late</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setLateMinutes(Math.max(1, lateMinutes - 5))} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-lg text-white hover:bg-ink-700">−</button>
              <input type="number" min={1} max={300} value={lateMinutes} onChange={(e) => setLateMinutes(Math.max(1, Math.min(300, Number(e.target.value) || 5)))}
                     className="w-24 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-center text-lg font-bold tabular-nums text-white outline-none focus:border-amber-400" />
              <button type="button" onClick={() => setLateMinutes(Math.min(300, lateMinutes + 5))} className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-lg text-white hover:bg-ink-700">+</button>
              <span className="text-xs text-ink-500">minutes</span>
            </div>
          </div>
        )}

        {/* Reason picker (absent) */}
        {status === "absent" && (
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold text-ink-400">Reason (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r === reason ? "" : r)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${reason === r ? "border-rose-400 bg-rose-500/20 text-rose-200" : "border-ink-700 bg-ink-950 text-ink-400 hover:text-white"}`}>
                  {r}
                </button>
              ))}
            </div>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Custom reason…" maxLength={200}
                   className="mt-2 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-rose-400" />
          </div>
        )}

        {/* WhatsApp parent — only for absent; opens wa.me with pre-filled msg */}
        {status === "absent" && (
          <ParentContactButtons studentId={row.studentId} />
        )}

        {/* Excuse upload — only for absent; parent/coach uploads doctor's note */}
        {status === "absent" && (
          <ExcuseUploadPanel row={row} date={date} />
        )}

        {/* Auto-join info banner — shown whether or not it "wins" over manual */}
        {row.autoJoin?.joinedAt && (
          <div className={`mt-4 rounded-lg border p-3 text-xs ${row.source === "live-class" ? "border-sky-500/30 bg-sky-500/10 text-sky-200" : "border-orange-500/30 bg-orange-500/10 text-orange-200"}`}>
            {row.source === "live-class" ? (
              <>✨ <b>Auto-detected</b> — joined Live Class at <b>{fmtTime(row.autoJoin.joinedAt)}</b>. Your manual mark (if any) overrides this.</>
            ) : (
              <>⚠️ <b>Conflict</b>: you marked <b>{statusStyle(row.status).label}</b>, but they joined Live Class at <b>{fmtTime(row.autoJoin.joinedAt)}</b>. Reconcile?</>
            )}
          </div>
        )}

        {/* Last 7 days strip */}
        {row.last7 && row.last7.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold text-ink-400">Last 7 days</div>
            <div className="flex gap-1">
              {row.last7.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <span className={`h-3 w-full rounded ${dayDotColor(d.status)}`} title={`${d.day}: ${d.status}`} />
                  <span className="text-[9px] text-ink-500">{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:text-white">Cancel</button>
          <Link to={`/academy/students/${row.studentId}/performance`} className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:text-white">View profile →</Link>
          <button type="button" onClick={() => onSave(status, status === "late" ? lateMinutes : null, status === "absent" ? (reason.trim() || null) : null)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Save</button>
        </div>
      </div>
    </div>
  );
}
