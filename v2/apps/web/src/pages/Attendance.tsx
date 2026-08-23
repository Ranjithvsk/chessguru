// Academy attendance sheet — coach or owner marks who showed up today.
// Owner directive 2026-08-23: default everyone PRESENT, tap-to-mark absent,
// reverse-order roster, modern colourful UI with coach + batch filters.
//
// Tap once   → LATE   (yellow, opens modal to set minutes)
// Tap twice  → ABSENT (red, opens modal to add reason)
// Tap thrice → back to PRESENT (green glow)
//
// Long-press a card → detail modal (edit minutes, reason, or open student
// profile). Auto-saves every tap via the bulk endpoint; undo toast for 2.2s.
// Route: /academy/attendance.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api, get, post } from "../lib/api";

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
  currentAttendanceStreak: number;
  lastPresentDate: string | null;
  absentYesterday: boolean;
  last7: Array<{ day: string; status: DayStatus }>;
};
type Resp = { ok: boolean; error?: string; date: string; coachId: string | null; batchId: string | null; rows: Row[]; lastClassDate: string | null };
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
            Everyone starts as <b className="text-emerald-300">Present</b>. Tap to change → Late → Absent → Present. Long-press for details.
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
          <StudentCard key={r.studentId} row={r} onTap={() => toggleOne(r)} onLongPress={() => setDetail(r)} pending={markMut.isPending} />
        ))}
      </div>

      {/* QR check-in modal */}
      {qrOpen && (
        <QrCheckinModal date={date} coachId={coachId || null} batchId={batchId || null}
                        onClose={() => setQrOpen(false)}
                        onCheckin={() => qc.invalidateQueries({ queryKey: ["attendance-sheet"] })} />
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

function StudentCard({ row, onTap, onLongPress, pending }: { row: Row; onTap: () => void; onLongPress: () => void; pending: boolean }) {
  const s = statusStyle(row.status);
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
    <button type="button" onClick={handleClick} disabled={pending}
      onMouseDown={startPress} onMouseUp={endPress} onMouseLeave={endPress}
      onTouchStart={startPress} onTouchEnd={endPress} onTouchCancel={endPress}
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
        <div className="truncate text-sm font-semibold text-white">{row.name}</div>
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

/** Bulk absent-notification modal — one row per absent student, each row
 *  fetches its parent contacts lazily and renders a "Send" button that
 *  opens WhatsApp with the pre-filled message. Coach clicks through the
 *  list in ~5 seconds per student. Marks each row as "sent" locally so the
 *  coach knows what they've already done. */
function NotifyAbsentModal({ date, absentRows, onClose }: { date: string; absentRows: Row[]; onClose: () => void }) {
  const [sent, setSent] = useState<Set<string>>(new Set());
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-400">Attendance · notify parents</div>
          <h2 className="mt-1 font-display text-2xl text-white">💬 WhatsApp absent parents</h2>
          <p className="mt-1 text-xs text-ink-400">{absentRows.length} student{absentRows.length === 1 ? "" : "s"} absent · click each to open WhatsApp</p>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {absentRows.map((r) => (
            <AbsentNotifyRow key={r.studentId} row={r} date={date} sent={sent.has(r.studentId)} onSent={() => setSent((s) => new Set(s).add(r.studentId))} />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-ink-500">{sent.size} / {absentRows.length} notified</div>
          <button type="button" onClick={onClose} className="rounded-lg border border-ink-700 px-4 py-2 text-sm font-semibold text-ink-300 hover:bg-ink-800 hover:text-white">Done</button>
        </div>
      </div>
    </div>
  );
}

function AbsentNotifyRow({ row, date, sent, onSent }: { row: Row; date: string; sent: boolean; onSent: () => void }) {
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
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 transition ${sent ? "border-emerald-500/40 bg-emerald-500/10" : "border-ink-800 bg-ink-950"}`}>
      <Avatar name={row.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-white">{row.name}</div>
        {row.reason && <div className="truncate text-[11px] italic text-ink-500">Reason: {row.reason}</div>}
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

function DetailModal({ row, onClose, onSave }: {
  row: Row;
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
