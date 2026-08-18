// Students Manager — dedicated roster page for academy owners with many
// students. Search + row-level actions (mark attended today, set/reset
// password, remove from academy). Owner-only. Coaches use the AcademyDashboard
// panels for lighter-weight per-batch views.

import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: "include" });
  if (!r.ok) { const e: any = new Error(`${path} ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
async function post<T>(path: string, body: any): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) { const e: any = new Error(`${path} ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

type Student = {
  _id: string;
  username: string;
  name?: string | null;
  email?: string | null;
  coachId?: string | null;
  createdAt?: string | null;
  lastLogin?: string | null;
  dailyStreakCurrent?: number | null;
  puzzleRating?: number | null;
  attendedTotal?: number | null;
  attendedThisWeek?: number | null;
  lastAttendedAt?: string | null;
};

type Coach = { _id: string; name?: string | null; username: string };

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  const now = Date.now();
  const secs = Math.max(0, (now - t.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  const days = Math.floor(secs / 86400);
  if (days < 30) return `${days}d ago`;
  return t.toISOString().slice(0, 10);
}

export default function StudentsManagerPage() {
  const authQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => get<{ loggedIn: boolean; role?: string; academyId?: string }>("/auth/me"),
  });
  const studentsQ = useQuery({
    queryKey: ["academy-students"],
    queryFn: () => get<Student[]>("/api/academy/students"),
    enabled: !!authQ.data?.loggedIn,
  });
  const coachesQ = useQuery({
    queryKey: ["academy-coaches"],
    queryFn: () => get<Coach[]>("/api/academy/coaches"),
    enabled: !!authQ.data?.loggedIn,
  });

  const [q, setQ] = useState("");
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addCoachId, setAddCoachId] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Student | null>(null);
  const [pwPromptFor, setPwPromptFor] = useState<Student | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const qc = useQueryClient();

  const addM = useMutation({
    mutationFn: (body: any) => post("/api/academy/students/quick-add", body),
    onSuccess: (res: any) => {
      if (res?.ok === false) { setFlash({ kind: "err", text: String(res.error || "Add failed.") }); return; }
      setAddName(""); setAddEmail(""); setAddOpen(false);
      setFlash({ kind: "ok", text: `Added ${res?.credentials?.username || "student"}. Password: ${res?.credentials?.password || "—"}` });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });

  // Attach-existing flow: pull an EXISTING platform user into the academy
  // as a student, preserving their puzzle rating + history. Separate form
  // + mutation so it can't be confused with the create-new flow.
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachHandle, setAttachHandle] = useState("");
  const [attachCoachId, setAttachCoachId] = useState("");
  const attachM = useMutation({
    mutationFn: (body: any) => post("/api/academy/students/attach-existing", body),
    onSuccess: (res: any) => {
      if (res?.ok === false) { setFlash({ kind: "err", text: String(res.error || "Attach failed.") }); return; }
      setAttachHandle(""); setAttachOpen(false);
      setFlash({ kind: "ok", text: `Attached ${res?.student?.username || "user"} — their existing puzzle history is preserved.` });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });
  const attendM = useMutation({
    mutationFn: (id: string) => post(`/api/academy/students/${encodeURIComponent(id)}/mark-attended`, {}),
    onSuccess: (res: any, id: string) => {
      if (res?.ok === false) setFlash({ kind: "err", text: String(res.error || "Mark failed.") });
      else setFlash({ kind: "ok", text: `Marked attended (${id})` });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });
  const pwM = useMutation({
    mutationFn: ({ id, pw }: { id: string; pw: string }) =>
      post(`/api/academy/students/${encodeURIComponent(id)}/set-password`, { newPassword: pw }),
    onSuccess: (res: any) => {
      if (res?.ok === false) { setFlash({ kind: "err", text: String(res.error || "Set-password failed.") }); return; }
      setPwPromptFor(null); setPwValue("");
      setFlash({ kind: "ok", text: `New password: ${res?.credentials?.password || "—"} (for ${res?.credentials?.username || "student"})` });
    },
  });
  const removeM = useMutation({
    mutationFn: (id: string) => post(`/api/academy/students/${encodeURIComponent(id)}/remove`, {}),
    onSuccess: (res: any) => {
      if (res?.ok === false) { setFlash({ kind: "err", text: String(res.error || "Remove failed.") }); return; }
      setConfirmRemove(null);
      setFlash({ kind: "ok", text: "Student removed from academy." });
      qc.invalidateQueries({ queryKey: ["academy-students"] });
    },
  });

  const coachName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of coachesQ.data ?? []) m.set(String(c._id), c.name || c.username);
    return (id?: string | null) => (id ? (m.get(String(id)) || String(id)) : "—");
  }, [coachesQ.data]);

  const filtered = useMemo(() => {
    const rows = studentsQ.data ?? [];
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((s) =>
      (s.name || "").toLowerCase().includes(needle) ||
      (s.username || "").toLowerCase().includes(needle) ||
      (s.email || "").toLowerCase().includes(needle),
    );
  }, [studentsQ.data, q]);

  if (authQ.isLoading) return <div className="p-8 text-ink-400 text-sm">Loading…</div>;
  if (!authQ.data?.loggedIn) return <Navigate to="/login" replace />;
  if (authQ.data.role !== "academy_owner") {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-ink-300">
        <div className="text-3xl mb-2">🔒</div>
        <div className="text-lg font-semibold">Owner only</div>
        <div className="mt-1 text-sm">This page manages the full student roster. Coaches see their students on the <Link to="/academy" className="text-brand-300 underline">academy dashboard</Link>.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-white">Students</h1>
          <div className="text-xs text-ink-400">
            {studentsQ.data ? `${studentsQ.data.length} total` : "loading…"}
            {q.trim() ? ` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text" placeholder="Search name / email / username" value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-white placeholder-ink-500 focus:border-brand-400 focus:outline-none"
            style={{ minWidth: 260 }}
          />
          <button
            type="button" onClick={() => { setAddOpen((v) => !v); if (!addOpen) setAttachOpen(false); }}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500"
          >+ Add student</button>
          <button
            type="button" onClick={() => { setAttachOpen((v) => !v); if (!attachOpen) setAddOpen(false); }}
            className="rounded-lg border border-brand-500 bg-brand-500/15 px-3 py-1.5 text-sm font-semibold text-brand-100 hover:bg-brand-500/25"
            title="Pull in an existing ChessGuru user (preserves their puzzle history)."
          >+ Add existing user</button>
        </div>
      </div>

      {flash && (
        <div
          className={`mb-3 rounded-lg px-3 py-2 text-sm ${flash.kind === "ok" ? "bg-emerald-500/15 text-emerald-100 border border-emerald-500/30" : "bg-rose-500/15 text-rose-100 border border-rose-500/30"}`}
        >
          {flash.text}
          <button className="ml-3 text-xs opacity-70 hover:opacity-100" onClick={() => setFlash(null)}>dismiss</button>
        </div>
      )}

      {addOpen && (
        <form
          className="mb-4 rounded-xl border border-ink-700 bg-ink-900/60 p-4 grid gap-3 md:grid-cols-4"
          onSubmit={(e) => { e.preventDefault(); addM.mutate({ displayName: addName, email: addEmail, coachId: addCoachId }); }}
        >
          <input
            type="text" placeholder="Student name (required)" value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder-ink-500"
            required
          />
          <input
            type="email" placeholder="Email (optional)" value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder-ink-500"
          />
          <select
            value={addCoachId} onChange={(e) => setAddCoachId(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white"
          >
            <option value="">— assign coach —</option>
            {(coachesQ.data ?? []).map((c) => (
              <option key={c._id} value={c._id}>{c.name || c.username}</option>
            ))}
          </select>
          <button
            type="submit" disabled={addM.isPending || !addName.trim()}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-emerald-500"
          >{addM.isPending ? "Adding…" : "Create student"}</button>
        </form>
      )}

      {attachOpen && (
        <form
          className="mb-4 rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 grid gap-3 md:grid-cols-4"
          onSubmit={(e) => { e.preventDefault(); attachM.mutate({ usernameOrEmail: attachHandle.trim(), coachId: attachCoachId }); }}
        >
          <input
            type="text" placeholder="Existing username or email (required)" value={attachHandle}
            onChange={(e) => setAttachHandle(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white placeholder-ink-500 md:col-span-2"
            required
          />
          <select
            value={attachCoachId} onChange={(e) => setAttachCoachId(e.target.value)}
            className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white"
          >
            <option value="">— assign coach —</option>
            {(coachesQ.data ?? []).map((c) => (
              <option key={c._id} value={c._id}>{c.name || c.username}</option>
            ))}
          </select>
          <button
            type="submit" disabled={attachM.isPending || !attachHandle.trim()}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-brand-500"
          >{attachM.isPending ? "Attaching…" : "Attach to academy"}</button>
          <div className="md:col-span-4 text-xs text-ink-400">
            Preserves the user's existing puzzle rating, solve history, and password. They keep their same login. Won't work if they're already in another academy.
          </div>
        </form>
      )}

      {studentsQ.isLoading && <div className="p-6 text-ink-400 text-sm">Loading students…</div>}
      {studentsQ.data && studentsQ.data.length === 0 && (
        <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-8 text-center text-ink-400">
          <div className="text-3xl">📭</div>
          <div className="mt-2 text-sm">No students yet. Click <span className="text-brand-300 font-semibold">+ Add student</span> above.</div>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-900/40">
          <table className="min-w-full text-sm">
            <thead className="bg-ink-800/70 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Coach</th>
                <th className="px-3 py-2 text-right">Rating</th>
                <th className="px-3 py-2 text-right">Streak</th>
                <th className="px-3 py-2 text-right">This week</th>
                <th className="px-3 py-2 text-left">Last active</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s._id} className="border-t border-ink-800 hover:bg-ink-800/40">
                  <td className="px-3 py-2">
                    <div className="text-white font-semibold">{s.name || s.username}</div>
                    <div className="text-xs text-ink-500">{s.email || s.username}</div>
                  </td>
                  <td className="px-3 py-2 text-ink-300">{coachName(s.coachId)}</td>
                  <td className="px-3 py-2 text-right text-brand-200 tabular-nums">{s.puzzleRating ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-amber-200 tabular-nums">{s.dailyStreakCurrent ?? 0}</td>
                  <td className="px-3 py-2 text-right text-emerald-200 tabular-nums">{s.attendedThisWeek ?? 0}</td>
                  <td className="px-3 py-2 text-ink-400 text-xs">{fmtDate(s.lastAttendedAt || s.lastLogin)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1.5">
                      <Link to={`/academy/students/${encodeURIComponent(s._id)}/performance`}
                        title="Open the performance dashboard"
                        className="rounded-md bg-sky-500/20 px-2 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-500/30"
                      >📊 Report</Link>
                      <button
                        type="button" title="Mark attended today"
                        onClick={() => attendM.mutate(s._id)}
                        disabled={attendM.isPending}
                        className="rounded-md bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                      >✓ Attend</button>
                      <button
                        type="button" title="Set / reset password"
                        onClick={() => { setPwPromptFor(s); setPwValue(""); }}
                        className="rounded-md bg-brand-500/20 px-2 py-1 text-xs font-semibold text-brand-100 hover:bg-brand-500/30"
                      >🔑 Password</button>
                      <button
                        type="button" title="Remove from academy"
                        onClick={() => setConfirmRemove(s)}
                        className="rounded-md bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-500/30"
                      >✕ Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pwPromptFor && (
        <Modal onClose={() => { setPwPromptFor(null); setPwValue(""); }}>
          <div className="text-lg font-semibold text-white">Set password for {pwPromptFor.name || pwPromptFor.username}</div>
          <div className="mt-1 text-xs text-ink-400">Leave blank to auto-generate (name + @123).</div>
          <input
            type="text" autoFocus value={pwValue}
            onChange={(e) => setPwValue(e.target.value)}
            placeholder="New password (or leave blank)"
            className="mt-3 w-full rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-sm text-white"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="rounded-lg bg-ink-700 px-3 py-1.5 text-sm text-white hover:bg-ink-600" onClick={() => { setPwPromptFor(null); setPwValue(""); }}>Cancel</button>
            <button
              type="button"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
              disabled={pwM.isPending}
              onClick={() => pwM.mutate({ id: pwPromptFor._id, pw: pwValue })}
            >{pwM.isPending ? "Setting…" : "Set password"}</button>
          </div>
        </Modal>
      )}

      {confirmRemove && (
        <Modal onClose={() => setConfirmRemove(null)}>
          <div className="text-lg font-semibold text-white">Remove {confirmRemove.name || confirmRemove.username}?</div>
          <div className="mt-2 text-sm text-ink-300">
            This detaches the student from your academy. Their user account, puzzle history, and rating are preserved — you can re-add them any time.
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="rounded-lg bg-ink-700 px-3 py-1.5 text-sm text-white hover:bg-ink-600" onClick={() => setConfirmRemove(null)}>Cancel</button>
            <button
              type="button"
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              disabled={removeM.isPending}
              onClick={() => removeM.mutate(confirmRemove._id)}
            >{removeM.isPending ? "Removing…" : "Remove"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
