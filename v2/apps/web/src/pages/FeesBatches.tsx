// /fees/batches — batch management moved out of AcademyDashboard (2026-08-30).
//
// A batch groups students under a coach so:
//   * Recurring classes can be scheduled for the group in one form.
//   * A fee program can be attached to it and every student enrolled in one
//     click (see /fees/programs → BatchLink → "Enrol from batch").
//
// Data: `academyBatches` collection. API stays at /api/academy/batches (also
// consumed by /academy/attendance) — this page is a UI move, not an API move.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const t = (s: string) => s;

interface ClassRow { _id: string; title: string; coach: string; startAt: string; durationMin: number; seriesId?: string | null; batchId?: string | null; durationMinutes?: number }
interface ScheduleResp { live: ClassRow[]; upcoming: ClassRow[] }

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`/v2api${path}`, { credentials: "include" });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export default function FeesBatchesPage() {
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => get<any>("/api/auth/me") });
  const students = useQuery({ queryKey: ["academy-students"], queryFn: () => get<any[]>("/api/academy/students") });
  const coaches = useQuery({ queryKey: ["academy-coaches"], queryFn: () => get<any[]>("/api/academy/coaches") });
  const schedule = useQuery({ queryKey: ["academy-schedule"], queryFn: () => get<ScheduleResp>("/api/class/schedule") });

  const me = meQ.data?.user;
  const isOwner = me?.role === "academy_owner";
  const canManage = isOwner || me?.role === "coach";

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

// ---- BatchClassStrip (copied from AcademyDashboard 2026-08-30) ---------
function BatchClassStrip({ classes, onChanged }: { classes: ClassRow[]; onChanged?: () => void }) {
  if (!classes.length) {
    return <div className="mb-3 rounded border border-dashed border-ink-700 px-2 py-1.5 text-[11px] text-ink-500">{t("No classes scheduled yet — hit 📅 below to add one.")}</div>;
  }
  const groups = new Map<string, { label: string; count: number; nextAt: Date; rep: ClassRow }>();
  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const c of classes) {
    const d = new Date(c.startAt);
    const key = `${d.getDay()}|${d.getHours()}:${d.getMinutes()}|${c.durationMin}`;
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const label = `${WEEKDAY[d.getDay()]} ${time} · ${c.durationMin}min`;
    const g = groups.get(key);
    if (!g) groups.set(key, { label, count: 1, nextAt: d, rep: c });
    else {
      g.count += 1;
      if (d < g.nextAt) { g.nextAt = d; g.rep = c; }
    }
  }
  const rows = [...groups.values()].sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime());

  const cancelGroup = async (g: { count: number; label: string; rep: ClassRow }) => {
    const isSeries = g.count > 1 && !!g.rep.seriesId;
    const msg = isSeries
      ? t(`Cancel every FUTURE class in this "${g.label}" series (${g.count} classes)? Past classes are kept as history.`)
      : t(`Cancel this class ("${g.label}")?`);
    if (!confirm(msg)) return;
    const url = isSeries
      ? `/v2api/api/class/schedule/series/${encodeURIComponent(g.rep.seriesId!)}`
      : `/v2api/api/class/schedule/${encodeURIComponent(g.rep._id)}`;
    const r = await fetch(url, { method: "DELETE", credentials: "include" });
    if (r.ok) onChanged?.();
    else {
      const j = await r.json().catch(() => ({}));
      alert(j?.message || t("Couldn't cancel."));
    }
  };

  return (
    <div className="mb-3 space-y-1 rounded border border-ink-700 bg-ink-900/60 px-2 py-1.5">
      {rows.slice(0, 3).map((g) => (
        <div key={g.label} className="flex items-center gap-2 text-[11px]">
          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 font-semibold text-emerald-200">📅</span>
          <span className="flex-1 text-ink-200">{g.label}</span>
          {g.count > 1 && <span className="text-[10px] tabular-nums text-ink-500">×{g.count}</span>}
          <button onClick={() => cancelGroup(g)}
            title={g.count > 1 ? t("Cancel all future classes in this series") : t("Cancel this class")}
            className="ml-0.5 rounded px-1 py-0.5 text-[10px] text-ink-500 hover:bg-rose-500/15 hover:text-rose-300">
            ✕
          </button>
        </div>
      ))}
      {rows.length > 3 && (
        <div className="pt-0.5 text-[10px] text-ink-500">+ {rows.length - 3} {t("more series")}</div>
      )}
    </div>
  );
}

// ---- BatchesPanel (copied from AcademyDashboard 2026-08-30) ------------
function BatchesPanel({ students, coaches = [], isOwner = false, classes = [] }: { students: any[]; coaches?: any[]; isOwner?: boolean; classes?: ClassRow[] }) {
  const qc = useQueryClient();
  const { data: batches = [], refetch } = useQuery({
    queryKey: ["academy-batches"],
    queryFn: async () => {
      const r = await fetch("/v2api/api/academy/batches", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batchCoachId, setBatchCoachId] = useState("");
  const [scheduleFor, setScheduleFor] = useState<any | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const startEdit = (b: any) => {
    setEditingId(b._id);
    setCreating(false);
    setNewName(b.name || "");
    setPicked(new Set((b.students || []).map((s: any) => String(s._id))));
    setBatchCoachId(String(b.coachUserId || ""));
  };
  const cancelForm = () => { setCreating(false); setEditingId(null); setNewName(""); setPicked(new Set()); setBatchCoachId(""); };
  const create = async () => {
    if (!newName.trim() || picked.size === 0) return;
    const url = editingId
      ? `/v2api/api/academy/batches/${encodeURIComponent(editingId)}`
      : "/v2api/api/academy/batches";
    const body: any = { name: newName.trim(), studentIds: [...picked] };
    if (isOwner && batchCoachId) body.coachUserId = batchCoachId;
    const r = await fetch(url, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j?.ok) {
      cancelForm();
      refetch();
      qc.invalidateQueries({ queryKey: ["academy-students"] });
      qc.invalidateQueries({ queryKey: ["fees.batches"] });
    } else alert(j?.error || (editingId ? t("Couldn't save changes.") : t("Couldn't create batch.")));
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(t(`Delete batch "${name}"? Existing scheduled classes stay.`))) return;
    const r = await fetch(`/v2api/api/academy/batches/${encodeURIComponent(id)}/delete`, { method: "POST", credentials: "include" });
    const j = await r.json();
    if (j?.ok) { refetch(); qc.invalidateQueries({ queryKey: ["fees.batches"] }); } else alert(j?.error || t("Couldn't delete."));
  };
  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg text-white">{t("Your batches")} <span className="ml-2 text-xs font-normal text-ink-400">({(batches as any[]).length})</span></h2>
        {!creating && !editingId && (
          <button onClick={() => setCreating(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">＋ {t("New batch")}</button>
        )}
      </div>
      {(creating || editingId) && (
        <div className="mb-4 rounded-lg border border-brand-500/40 bg-brand-500/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-300">
            {editingId ? t("Edit batch") : t("New batch")}
          </div>
          <label className="mb-1 block text-xs uppercase text-ink-400">{t("Batch name")}</label>
          <input
            value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("Monday Advanced Kids")}
            className="mb-3 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-100 placeholder-ink-500"
          />
          {isOwner && (
            <>
              <label className="mb-1 block text-xs uppercase text-ink-400">
                {t("Coach for this batch")}
                <span className="ml-2 text-[10px] font-normal normal-case text-ink-500">{t("every student in the batch is assigned to this coach on save")}</span>
              </label>
              <select
                value={batchCoachId} onChange={(e) => setBatchCoachId(e.target.value)}
                className="mb-3 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-ink-100"
              >
                <option value="">{t("— pick a coach —")}</option>
                {coaches.map((c: any) => (
                  <option key={c._id} value={c._id}>{c.name || c.username}{c.isOwner ? " · Owner" : ""}</option>
                ))}
              </select>
            </>
          )}
          <label className="mb-1 block text-xs uppercase text-ink-400">{t("Pick students")} ({picked.size}/{students.length})</label>
          <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-ink-700 bg-ink-800 p-2">
            {students.map((s) => (
              <label key={s._id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-ink-100 hover:bg-ink-700">
                <input
                  type="checkbox"
                  checked={picked.has(s._id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(s._id); else next.delete(s._id);
                    setPicked(next);
                  }}
                />
                {s.name || s.username}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={create} disabled={!newName.trim() || picked.size === 0} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40">
              {editingId ? t("Save changes") : t("Create")}
            </button>
            <button onClick={cancelForm} className="rounded-lg bg-ink-800 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-700">{t("Cancel")}</button>
          </div>
        </div>
      )}
      {(batches as any[]).length === 0 && !creating && (
        <p className="text-sm text-ink-400">{t("No batches yet. Create one to schedule recurring classes for a group of students in a single form.")}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(batches as any[]).map((b: any) => (
          <div key={b._id} className="rounded-lg border border-ink-700 bg-ink-800 p-4">
            <div className="mb-1 flex items-center justify-between">
              <div className="font-display text-base text-ink-100">{b.name}</div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => startEdit(b)} title={t("Rename batch or change its student list")}
                  className="text-xs text-ink-500 hover:text-brand-300">✏️</button>
                <button onClick={() => remove(b._id, b.name)} title={t("Delete batch")} className="text-xs text-ink-500 hover:text-rose-300">🗑</button>
              </div>
            </div>
            <div className="mb-3 text-xs text-ink-400">{(b.students || []).length} students · {(b.students || []).slice(0, 4).map((s: any) => s.name).join(", ")}{(b.students || []).length > 4 ? "…" : ""}</div>
            <BatchClassStrip classes={classes.filter((c) => c.batchId === b._id)}
              onChanged={() => qc.invalidateQueries({ queryKey: ["academy-schedule"] })} />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setScheduleFor(b)} className="rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25">📅 {t("Schedule class")}</button>
              <Link to={`/academy/batches/${encodeURIComponent(b._id)}/performance`}
                className="rounded-lg border border-sky-500/50 bg-sky-500/15 px-3 py-1.5 text-sm font-semibold text-sky-100 hover:bg-sky-500/25">
                📊 {t("Batch report")}
              </Link>
            </div>
          </div>
        ))}
      </div>
      {scheduleFor && <ScheduleBatchModal batch={scheduleFor} onClose={() => { setScheduleFor(null); qc.invalidateQueries({ queryKey: ["academy-schedule"] }); }} />}
    </section>
  );
}

// ---- ScheduleBatchModal (copied from AcademyDashboard 2026-08-30) ------
function ScheduleBatchModal({ batch, onClose }: { batch: any; onClose: () => void }) {
  const [title, setTitle] = useState(`${batch.name} class`);
  const [startAt, setStartAt] = useState(() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [durationMin, setDurationMin] = useState(60);
  const [recurrence, setRecurrence] = useState<"none" | "weekly">("none");
  const [recurrenceCount, setRecurrenceCount] = useState(4);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const toggleDay = (d: number) => setWeekdays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const submit = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/v2api/api/academy/batches/${encodeURIComponent(batch._id)}/schedule`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), startAt: new Date(startAt).toISOString(), durationMin, recurrence, recurrenceCount, recurrenceWeekdays: weekdays, roomKind: "meet" }),
      });
      const j = await r.json();
      if (j?.ok) { setMsg(t(`Scheduled ${j.count} class${j.count > 1 ? "es" : ""} for ${batch.name}.`)); setTimeout(onClose, 1400); }
      else setMsg(j?.error || t("Couldn't schedule."));
    } catch (e: any) { setMsg(e?.message || t("Network error.")); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg text-white">{t("Schedule class for")} {batch.name}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-white">✕</button>
        </div>
        <div className="mb-2 text-xs text-ink-400">{(batch.students || []).length} {t("students in this batch")}</div>
        <label className="mb-1 block text-xs uppercase text-ink-400">{t("Class title")}</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mb-3 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
        <label className="mb-1 block text-xs uppercase text-ink-400">{t("Start")}</label>
        <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="mb-3 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
        <label className="mb-1 block text-xs uppercase text-ink-400">{t("Duration (min)")}</label>
        <input type="number" min={5} max={600} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className="mb-3 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
        <label className="mb-1 block text-xs uppercase text-ink-400">{t("Recurrence")}</label>
        <div className="mb-3 flex gap-2">
          <label className="flex items-center gap-1.5 text-sm text-white"><input type="radio" checked={recurrence === "none"} onChange={() => setRecurrence("none")} /> {t("One-off")}</label>
          <label className="flex items-center gap-1.5 text-sm text-white"><input type="radio" checked={recurrence === "weekly"} onChange={() => setRecurrence("weekly")} /> {t("Weekly")}</label>
        </div>
        {recurrence === "weekly" && (
          <>
            <label className="mb-1 block text-xs uppercase text-ink-400">{t("Days of week (blank = same weekday as Start)")}</label>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((label, i) => (
                <button
                  key={i} onClick={() => toggleDay(i)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${weekdays.includes(i) ? "bg-brand-600 text-white" : "border border-ink-700 bg-ink-800 text-ink-300 hover:bg-ink-700"}`}
                >{label}</button>
              ))}
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs uppercase text-ink-400">{t("How many classes total (max 52)")}</label>
              <input type="number" min={1} max={52} value={recurrenceCount} onChange={(e) => setRecurrenceCount(Number(e.target.value))} className="w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white" />
              <p className="mt-1 text-[11px] text-ink-500">{t("Pick weekdays above for Mon/Wed/Fri-style schedules — leave blank for one class per week on the Start day.")}</p>
            </div>
          </>
        )}
        {msg && <p className={`mb-2 text-xs ${msg.startsWith("Scheduled") ? "text-emerald-300" : "text-rose-300"}`}>{msg}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg bg-ink-800 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-700">{t("Cancel")}</button>
          <button onClick={submit} disabled={busy || !title.trim()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40">{busy ? "…" : t("Schedule")}</button>
        </div>
      </div>
    </div>
  );
}

// Silence unused-var — kept for future once we wire fees.batches invalidation.
void useMutation;
